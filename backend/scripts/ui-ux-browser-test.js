/* Authenticated, read-only Edge acceptance test for the Admin and Officer UI. */
'use strict';

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
require('dotenv').config({ quiet: true });
const db = require('../config/database');

const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const debugPort = Number(process.env.EDGE_DEBUG_PORT || 9337);
const projectUrl = 'http://localhost/vehicle-violation-system-EASY-SETUP/frontend/pages';
const artifactRoot = path.resolve(__dirname, '../../ui-ux-artifacts/after');
const baselineArtifactRoot = path.resolve(__dirname, '../../ui-ux-artifacts/before');
const baselineProjectUrl = 'http://localhost/vehicle-violation-system-EASY-SETUP/.ui-ux-backups/20260806-before-finalization/frontend/pages';

async function retryJson(url, options = {}, attempts = 50) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
            const response = await fetch(url, options);
            if (response.ok) return response.json();
            lastError = new Error(`HTTP ${response.status}`);
        } catch (error) {
            lastError = error;
        }
        await sleep(200);
    }
    throw lastError;
}

class CdpClient {
    constructor(url) {
        this.socket = new WebSocket(url);
        this.nextId = 1;
        this.pending = new Map();
        this.listeners = new Map();
    }

    async connect() {
        await new Promise((resolve, reject) => {
            this.socket.addEventListener('open', resolve, { once: true });
            this.socket.addEventListener('error', reject, { once: true });
        });
        this.socket.addEventListener('message', (event) => {
            const message = JSON.parse(event.data);
            if (message.id) {
                const pending = this.pending.get(message.id);
                if (!pending) return;
                this.pending.delete(message.id);
                if (message.error) pending.reject(new Error(message.error.message));
                else pending.resolve(message.result || {});
                return;
            }
            for (const listener of this.listeners.get(message.method) || []) {
                listener(message.params || {});
            }
        });
    }

    send(method, params = {}) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }

    on(method, listener) {
        const listeners = this.listeners.get(method) || [];
        listeners.push(listener);
        this.listeners.set(method, listeners);
    }

    once(method) {
        return new Promise((resolve) => {
            const listener = (params) => {
                const listeners = this.listeners.get(method) || [];
                this.listeners.set(method, listeners.filter((item) => item !== listener));
                resolve(params);
            };
            this.on(method, listener);
        });
    }

    close() {
        this.socket.close();
    }
}

const pageAuditExpression = `(() => {
    const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const parseColor = (value) => {
        const match = String(value || '').match(/rgba?\\(([^)]+)\\)/i);
        if (!match) return null;
        const parts = match[1].split(',').map(part => Number.parseFloat(part.trim()));
        return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
    };
    const luminance = (color) => {
        const channels = color.slice(0, 3).map(channel => {
            const normalized = channel / 255;
            return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const contrast = (foreground, background) => {
        const foregroundLuminance = luminance(foreground);
        const backgroundLuminance = luminance(background);
        return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
            (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
    };
    const effectiveBackground = (element) => {
        let current = element;
        while (current) {
            const style = getComputedStyle(current);
            if (style.backgroundImage && style.backgroundImage !== 'none') return null;
            const color = parseColor(style.backgroundColor);
            if (color && color[3] >= 0.95) return color;
            current = current.parentElement;
        }
        return [255, 255, 255, 1];
    };
    const unlabeled = [...document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select, textarea')]
        .filter(visible)
        .filter((element) => {
            const label = element.id && document.querySelector('label[for="' + CSS.escape(element.id) + '"]');
            const wrapped = element.closest('label');
            const utilitySearch = element.closest('.search-bar, .topbar-search');
            return !label && !wrapped && !utilitySearch && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby');
        })
        .map((element) => element.id || element.name || element.outerHTML.slice(0, 80));
    const tinyMobileTargets = innerWidth <= 390
        ? [...document.querySelectorAll('button, a.btn, .action-btn, .icon-btn, input[type="checkbox"]')]
            .filter(visible)
            .filter((element) => {
                const rect = element.getBoundingClientRect();
                if (element.matches('input[type="checkbox"]')) {
                    const label = element.closest('label') || (element.id && document.querySelector('label[for="' + CSS.escape(element.id) + '"]'));
                    const labelRect = label?.getBoundingClientRect();
                    if (labelRect && labelRect.width >= 43 && labelRect.height >= 43) return false;
                }
                return rect.width < 43 || rect.height < 43;
            })
            .map((element) => (element.textContent || element.getAttribute('aria-label') || element.className || element.tagName).trim().slice(0, 60))
        : [];
    const duplicateIds = [...document.querySelectorAll('[id]')]
        .map((element) => element.id)
        .filter((id, index, ids) => id && ids.indexOf(id) !== index)
        .filter((id, index, ids) => ids.indexOf(id) === index);
    const lowContrast = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,span,a,button,label,td,th,small,strong,li,div')]
        .filter(visible)
        .filter(element => !element.matches(':disabled,[aria-hidden="true"],.sr-only') && !element.closest('[aria-hidden="true"]'))
        .filter(element => [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()))
        .map(element => {
            const style = getComputedStyle(element);
            const foreground = parseColor(style.color);
            const background = effectiveBackground(element);
            if (!foreground || !background || foreground[3] < 0.95) return null;
            const ratio = contrast(foreground, background);
            const size = Number.parseFloat(style.fontSize) || 16;
            const weight = Number.parseInt(style.fontWeight, 10) || 400;
            const threshold = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
            return ratio + 0.01 < threshold ? {
                text: element.textContent.trim().replace(/\\s+/g, ' ').slice(0, 45),
                ratio: Number(ratio.toFixed(2))
            } : null;
        })
        .filter(Boolean)
        .slice(0, 12);
    return {
        path: location.pathname.split('/').pop(),
        title: document.title,
        overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth,
        unlabeled,
        tinyMobileTargets,
        lowContrast,
        duplicateIds,
        modalCount: document.querySelectorAll('#appConfirmationModal').length,
        ready: document.readyState,
        hasMain: Boolean(document.querySelector('main, .main-content')),
        visibleText: (document.body.innerText || '').trim().length
    };
})()`;

async function createTarget(user, token) {
    const target = await retryJson(
        `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent('about:blank')}`,
        { method: 'PUT' }
    );
    const cdp = new CdpClient(target.webSocketDebuggerUrl);
    await cdp.connect();
    const state = { errors: [] };
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
        state.errors.push(exceptionDetails?.exception?.description || exceptionDetails?.text || 'Runtime exception');
    });
    cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
        if (type !== 'error') return;
        const message = (args || []).map((item) => item.value || item.description || '').join(' ');
        state.errors.push(message || 'console.error');
    });
    await Promise.all([
        cdp.send('Page.enable'),
        cdp.send('Runtime.enable'),
        cdp.send('Network.enable'),
        cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
    ]);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `if (!location.pathname.toLowerCase().endsWith('/login.html')) { localStorage.setItem('token', ${JSON.stringify(token)}); localStorage.setItem('user', ${JSON.stringify(JSON.stringify(user))}); }`
    });
    return { cdp, state };
}

async function evaluate(cdp, expression) {
    const result = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true
    });
    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result?.value;
}

async function navigate(cdp, url) {
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url });
    await Promise.race([
        loaded,
        sleep(15000).then(() => { throw new Error(`Page load timeout: ${url}`); })
    ]);
    await sleep(650);
}

async function capture(cdp, fileName, destination = artifactRoot) {
    fs.mkdirSync(destination, { recursive: true });
    const { data } = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
        fromSurface: true
    });
    fs.writeFileSync(path.join(destination, fileName), Buffer.from(data, 'base64'));
}

async function auditRole(roleName, user, token, pages, viewports, screenshotPages) {
    const { cdp, state } = await createTarget(user, token);
    const results = [];
    try {
        for (const viewport of viewports) {
            await cdp.send('Emulation.setDeviceMetricsOverride', {
                width: viewport,
                height: viewport <= 390 ? 844 : 900,
                deviceScaleFactor: 1,
                mobile: viewport <= 390
            });
            for (const page of pages) {
                state.errors.length = 0;
                await navigate(cdp, `${projectUrl}/${page}`);
                const audit = await evaluate(cdp, pageAuditExpression);
                const expectedPage = page.split('?')[0];
                assert(audit.path === expectedPage, `${roleName}/${expectedPage} redirected to ${audit.path}`);
                assert(audit.ready === 'complete' && audit.hasMain && audit.visibleText > 20, `${roleName}/${expectedPage} did not render`);
                assert(audit.overflow <= 2, `${roleName}/${expectedPage} has ${audit.overflow}px document overflow at ${viewport}px`);
                assert(audit.unlabeled.length === 0, `${roleName}/${expectedPage} has unlabeled fields: ${audit.unlabeled.join(', ')}`);
                assert(audit.lowContrast.length === 0, `${roleName}/${expectedPage} has low-contrast text: ${audit.lowContrast.map(item => item.text + ' (' + item.ratio + ':1)').join(', ')}`);
                assert(audit.duplicateIds.length === 0, `${roleName}/${expectedPage} has duplicate IDs: ${audit.duplicateIds.join(', ')}`);
                assert(audit.modalCount <= 1, `${roleName}/${expectedPage} duplicated the shared confirmation modal`);
                assert(state.errors.length === 0, `${roleName}/${expectedPage} console errors: ${state.errors.join(' | ')}`);
                if (audit.tinyMobileTargets.length) {
                    results.push(`WARNING ${expectedPage}: small mobile targets: ${audit.tinyMobileTargets.join(', ')}`);
                }
                if (screenshotPages.has(expectedPage) && (viewport === 1440 || viewport === 390)) {
                    await capture(cdp, `${roleName}-${expectedPage.replace('.html', '')}-${viewport}.png`);
                }
            }
            results.push(`${roleName} ${viewport}px: PASS (${pages.length} pages)`);
            console.log(results[results.length - 1]);
        }
    } finally {
        cdp.close();
    }
    return results;
}

async function roleGuardTest(admin, adminToken, officer, officerToken) {
    const adminTarget = await createTarget(admin, adminToken);
    try {
        await navigate(adminTarget.cdp, `${projectUrl}/officer-dashboard.html`);
        const adminPath = await evaluate(adminTarget.cdp, 'location.pathname.split("/").pop()');
        assert(adminPath === 'admin-dashboard.html', `Admin officer-page guard failed: ${adminPath}`);
    } finally {
        adminTarget.cdp.close();
    }

    const officerTarget = await createTarget(officer, officerToken);
    try {
        await navigate(officerTarget.cdp, `${projectUrl}/manage-users.html`);
        const officerPath = await evaluate(officerTarget.cdp, 'location.pathname.split("/").pop()');
        assert(officerPath === 'officer-dashboard.html', `Officer admin-page guard failed: ${officerPath}`);
    } finally {
        officerTarget.cdp.close();
    }

    const unsupportedTarget = await createTarget({ id: 0, name: 'Unsupported', role: 'driver' }, 'ui-only-test-token');
    try {
        // This guard intentionally redirects during initial parsing, which can replace
        // the loader before CDP emits the original load event. Allow the redirect to settle.
        await unsupportedTarget.cdp.send('Page.navigate', { url: `${projectUrl}/view-tickets.html` });
        await sleep(1500);
        const result = await evaluate(unsupportedTarget.cdp, `({ path: location.pathname.split('/').pop(), token: localStorage.getItem('token') })`);
        assert(result.path === 'login.html' && !result.token, `Unsupported-role guard failed: ${result.path}`);
    } finally {
        unsupportedTarget.cdp.close();
    }
    console.log('role guards: PASS');
}

async function interactionSafetyTest(admin, adminToken) {
    const { cdp, state } = await createTarget(admin, adminToken);
    let mutationRequests = 0;
    cdp.on('Network.requestWillBeSent', ({ request }) => {
        if (request && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && request.url.includes('/api/')) {
            mutationRequests += 1;
        }
    });
    try {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
            width: 390, height: 844, deviceScaleFactor: 1, mobile: true
        });
        await navigate(cdp, `${projectUrl}/issue-ticket.html`);
        await evaluate(cdp, `document.getElementById('resetTicketButton').click(); true`);
        await sleep(100);
        assert(await evaluate(cdp, `document.getElementById('appConfirmationModal')?.classList.contains('active')`), 'Reset confirmation did not open.');
        await evaluate(cdp, `document.querySelector('#appConfirmationModal [data-confirm-result="false"]').click(); true`);
        assert(!(await evaluate(cdp, `document.getElementById('appConfirmationModal').classList.contains('active')`)), 'Reset confirmation did not cancel.');

        await evaluate(cdp, `document.getElementById('issueTicketForm').requestSubmit(); true`);
        await sleep(150);
        const validation = await evaluate(cdp, `(() => ({
            invalid: document.querySelectorAll('#issueTicketForm [aria-invalid="true"]').length,
            errors: document.querySelectorAll('#issueTicketForm .error-message[role="alert"]').length,
            focusedInvalid: document.activeElement?.getAttribute('aria-invalid') === 'true'
        }))()`);
        assert(validation.invalid > 0 && validation.errors > 0 && validation.focusedInvalid, 'Ticket form did not show focused field-level errors.');

        await navigate(cdp, `${projectUrl}/manage-users.html`);
        const deleteReady = await evaluate(cdp, `Boolean([...document.querySelectorAll('button.btn-danger')].find(button => !button.disabled && /delete/i.test(button.textContent)))`);
        assert(deleteReady, 'No safe delete control was available for modal testing.');
        await evaluate(cdp, `[...document.querySelectorAll('button.btn-danger')].find(button => !button.disabled && /delete/i.test(button.textContent)).click(); true`);
        await sleep(100);
        assert(await evaluate(cdp, `document.getElementById('appConfirmationModal')?.classList.contains('active')`), 'Account deletion confirmation did not open.');
        await evaluate(cdp, `document.querySelector('#appConfirmationModal [data-confirm-result="false"]').click(); true`);

        await evaluate(cdp, `document.querySelector('.sidebar-nav [data-action="logout"]').click(); true`);
        await sleep(100);
        assert(await evaluate(cdp, `document.getElementById('appConfirmationModal')?.classList.contains('active')`), 'Logout confirmation did not open.');
        await evaluate(cdp, `document.querySelector('#appConfirmationModal [data-confirm-result="false"]').click(); true`);
        assert(await evaluate(cdp, `location.pathname.endsWith('/manage-users.html') && Boolean(localStorage.getItem('token'))`), 'Cancelling logout ended the session.');

        assert(mutationRequests === 0, `Safety interaction test sent ${mutationRequests} mutation request(s).`);
        assert(state.errors.length === 0, `Safety interaction console errors: ${state.errors.join(' | ')}`);
        console.log('field validation and confirmation-cancel safety: PASS');
    } finally {
        cdp.close();
    }
}

async function captureBaseline(admin, adminToken) {
    const { cdp } = await createTarget(admin, adminToken);
    try {
        const pages = ['admin-dashboard.html', 'manage-users.html', 'issue-ticket.html', 'analytics-dashboard.html', 'notifications.html'];
        for (const viewport of [1440, 390]) {
            await cdp.send('Emulation.setDeviceMetricsOverride', {
                width: viewport,
                height: viewport === 390 ? 844 : 900,
                deviceScaleFactor: 1,
                mobile: viewport === 390
            });
            for (const page of pages) {
                await navigate(cdp, `${baselineProjectUrl}/${page}`);
                await capture(cdp, `admin-${page.replace('.html', '')}-${viewport}.png`, baselineArtifactRoot);
            }
        }
        console.log('Representative baseline screenshots: PASS (10 captures)');
    } finally {
        cdp.close();
    }
}

async function main() {
    try {
        assert(process.env.JWT_SECRET, 'JWT_SECRET is required for browser validation.');
        const [admins] = await db.query(
            `SELECT id, name, email, role FROM users WHERE role = 'admin' AND status = 'active' ORDER BY id LIMIT 1`
        );
        const [officers] = await db.query(
            `SELECT id, name, email, role FROM users WHERE role = 'apprehending_officer' AND status = 'active' ORDER BY id LIMIT 1`
        );
        const admin = admins[0];
        const officer = officers[0];
        assert(admin, 'An active Administrator is required.');
        assert(officer, 'An active Apprehending Officer is required.');

        const [[adminTicket]] = await db.query('SELECT id FROM tickets ORDER BY id LIMIT 1');
        const [[officerTicket]] = await db.query('SELECT id FROM tickets WHERE user_id = ? ORDER BY id LIMIT 1', [officer.id]);
        const adminToken = jwt.sign({ id: admin.id, name: admin.name, email: admin.email, role: admin.role }, process.env.JWT_SECRET, { expiresIn: '15m' });
        const officerToken = jwt.sign({ id: officer.id, name: officer.name, email: officer.email, role: officer.role }, process.env.JWT_SECRET, { expiresIn: '15m' });

        if (process.env.UI_ROLE_GUARD_ONLY === '1') {
            await roleGuardTest(admin, adminToken, officer, officerToken);
            console.log('UI/UX role-guard validation: PASS');
            return;
        }

        if (process.env.UI_INTERACTION_ONLY === '1') {
            await interactionSafetyTest(admin, adminToken);
            console.log('UI/UX interaction safety validation: PASS');
            return;
        }

        if (process.env.UI_CAPTURE_BASELINE_ONLY === '1') {
            await captureBaseline(admin, adminToken);
            return;
        }

        const adminPages = [
            'admin-dashboard.html', 'admin-overview.html', 'issue-ticket.html', 'view-tickets.html',
            'license-plate-lookup.html', 'manage-violations.html', 'manage-users.html', 'payments.html',
            'disputes.html', 'reports.html', 'analytics-dashboard.html', 'audit-logs.html',
            'notifications.html', 'admin-settings.html', 'profile.html'
        ];
        if (adminTicket) adminPages.push(`ticket-details.html?id=${adminTicket.id}`);
        const officerPages = [
            'officer-dashboard.html', 'issue-ticket.html', 'view-tickets.html', 'license-plate-lookup.html',
            'disputes.html', 'notifications.html', 'profile.html'
        ];
        if (officerTicket) officerPages.push(`ticket-details.html?id=${officerTicket.id}`);

        const viewports = process.env.UI_MOBILE_ONLY === '1' ? [390] : [1440, 1024, 768, 390];
        const screenshotPages = new Set([
            'admin-dashboard.html', 'officer-dashboard.html', 'issue-ticket.html', 'manage-users.html',
            'analytics-dashboard.html', 'license-plate-lookup.html', 'notifications.html'
        ]);
        const adminResults = await auditRole('admin', admin, adminToken, adminPages, viewports, screenshotPages);
        const officerResults = await auditRole('officer', officer, officerToken, officerPages, viewports, screenshotPages);
        await roleGuardTest(admin, adminToken, officer, officerToken);

        const warnings = [...adminResults, ...officerResults].filter((result) => result.startsWith('WARNING'));
        console.log(`UI/UX browser validation: PASS (${(adminPages.length + officerPages.length) * viewports.length} authenticated page/viewport checks)`);
        warnings.forEach(warning => console.log(warning));
        console.log(`Mobile target warnings: ${warnings.length}`);
    } finally {
        await db.end();
    }
}

main().catch((error) => {
    console.error(`UI/UX browser validation: FAIL - ${error.message}`);
    process.exitCode = 1;
});
