/* Real-browser notification deletion acceptance test using Edge DevTools. */
'use strict';

const jwt = require('jsonwebtoken');
require('dotenv').config({ quiet: true });
const db = require('../config/database');

const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const debugPort = Number(process.env.EDGE_DEBUG_PORT || 9334);
const pageUrl = 'http://localhost/vehicle-violation-system-EASY-SETUP/frontend/pages/notifications.html';
const fixtureType = 'notification_browser_test';
const runId = Math.floor(Date.now() / 1000);

async function retryJson(url, options = {}, attempts = 40) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
            const response = await fetch(url, options);
            if (response.ok) return response.json();
            lastError = new Error(`HTTP ${response.status}`);
        } catch (error) {
            lastError = error;
        }
        await sleep(250);
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
            for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
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

const insertFixture = async (userId, title, isRead = 0) => {
    const [result] = await db.query(
        `INSERT INTO notifications
            (user_id, type, title, message, is_read, read_at, reference_type, reference_id)
         VALUES (?, ?, ?, ?, ?, IF(? = 1, NOW(), NULL), ?, ?)`,
        [userId, fixtureType, title, 'Browser notification deletion validation.', isRead, isRead, fixtureType, runId]
    );
    return result.insertId;
};

async function main() {
    let cdp;
    let admin;
    const results = [];

    try {
        const [admins] = await db.query(
            `SELECT id, name, email, role
             FROM users
             WHERE status = 'active' AND role = 'admin'
             ORDER BY id LIMIT 1`
        );
        admin = admins[0];
        assert(admin, 'An active administrator is required for the browser test.');

        const [[baseline]] = await db.query(
            'SELECT COUNT(*) AS total, COALESCE(SUM(is_read = 0), 0) AS unread FROM notifications WHERE user_id = ?',
            [admin.id]
        );

        const ids = {
            cancel: await insertFixture(admin.id, `Cancel ${runId}`),
            one: await insertFixture(admin.id, `Delete one ${runId}`),
            double: await insertFixture(admin.id, `Double ${runId}`),
            bulkOne: await insertFixture(admin.id, `Bulk one ${runId}`),
            bulkTwo: await insertFixture(admin.id, `Bulk two ${runId}`, 1),
            unread: await insertFixture(admin.id, `Unread filter ${runId}`),
            read: await insertFixture(admin.id, `Read filter ${runId}`, 1)
        };

        const token = jwt.sign({
            id: admin.id,
            email: admin.email,
            role: admin.role,
            name: admin.name
        }, process.env.JWT_SECRET, { expiresIn: '10m' });

        await retryJson(`http://127.0.0.1:${debugPort}/json/version`);
        const target = await retryJson(
            `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent('about:blank')}`,
            { method: 'PUT' }
        );
        cdp = new CdpClient(target.webSocketDebuggerUrl);
        await cdp.connect();

        let deleteRequests = 0;
        const browserErrors = [];
        cdp.on('Network.requestWillBeSent', ({ request }) => {
            if (request && request.url.includes('/api/notifications') && request.method === 'DELETE') {
                deleteRequests += 1;
            }
        });
        cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
            browserErrors.push(exceptionDetails?.exception?.description || exceptionDetails?.text || 'Browser exception');
        });

        await Promise.all([
            cdp.send('Page.enable'),
            cdp.send('Runtime.enable'),
            cdp.send('Network.enable'),
            cdp.send('Emulation.setDeviceMetricsOverride', {
                width: 1365,
                height: 768,
                deviceScaleFactor: 1,
                mobile: false
            })
        ]);

        await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
            source: `localStorage.setItem('token', ${JSON.stringify(token)}); localStorage.setItem('user', ${JSON.stringify(JSON.stringify(admin))});`
        });

        const loaded = cdp.once('Page.loadEventFired');
        await cdp.send('Page.navigate', { url: pageUrl });
        await loaded;

        const evaluate = async (expression) => {
            const result = await cdp.send('Runtime.evaluate', {
                expression,
                awaitPromise: true,
                returnByValue: true
            });
            if (result.exceptionDetails) {
                throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
            }
            return result.result?.value;
        };

        const waitFor = async (expression, timeoutMs = 15000) => {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                if (await evaluate(expression)) return;
                await sleep(100);
            }
            throw new Error(`Browser condition timed out: ${expression}`);
        };

        const rowExists = (id) => `Boolean(document.querySelector('tr[data-notification-id="${id}"]'))`;
        const clickDeleteFor = (id) => evaluate(`document.querySelector('tr[data-notification-id="${id}"] .delete-notification-button').click(); true`);
        await waitFor(rowExists(ids.cancel));

        assert(await evaluate(`document.querySelectorAll('#deleteConfirmationModal').length`) === 1, 'Confirmation modal is duplicated.');
        assert(await evaluate(`document.querySelectorAll('#notificationsTableBody').length`) === 1, 'Notification table body is duplicated.');
        const initialDisplayedTotal = Number(await evaluate(`document.getElementById('totalNotificationCount').textContent`));
        assert(initialDisplayedTotal === Number(baseline.total) + 7, 'Initial notification count is incorrect.');

        await evaluate(`document.getElementById('selectAllNotifications').click(); true`);
        assert(await evaluate(`(() => {
            const checkboxes = [...document.querySelectorAll('.row-notification-checkbox')];
            return checkboxes.length > 0 && checkboxes.every(checkbox => checkbox.checked);
        })()`), 'Select All did not select every visible notification.');
        await evaluate(`document.getElementById('selectAllNotifications').click(); true`);
        assert(await evaluate(`document.getElementById('deleteSelectedButton').disabled`), 'Clearing Select All left Delete Selected enabled.');
        results.push('select all toggle: PASS');

        const cancelRequestCount = deleteRequests;
        await clickDeleteFor(ids.cancel);
        assert(await evaluate(`document.getElementById('deleteConfirmationModal').classList.contains('active')`), 'Delete confirmation did not open.');
        await evaluate(`document.getElementById('cancelDeleteButton').click(); true`);
        assert(await evaluate(rowExists(ids.cancel)), 'Cancel removed a notification.');
        assert(deleteRequests === cancelRequestCount, 'Cancel sent a delete request.');
        results.push('cancel deletion: PASS');

        await clickDeleteFor(ids.one);
        await evaluate(`document.getElementById('confirmDeleteButton').click(); true`);
        await waitFor(`!${rowExists(ids.one)}`);
        assert(Number(await evaluate(`document.getElementById('totalNotificationCount').textContent`)) === initialDisplayedTotal - 1, 'Delete-one count did not update.');
        results.push('delete one without page reload: PASS');

        const doubleStart = deleteRequests;
        await clickDeleteFor(ids.double);
        await evaluate(`(() => { const button = document.getElementById('confirmDeleteButton'); button.click(); button.click(); return true; })()`);
        await waitFor(`!${rowExists(ids.double)}`);
        assert(deleteRequests === doubleStart + 1, 'Double click sent more than one delete request.');
        results.push('double-click protection: PASS');

        await evaluate(`(() => {
            for (const id of [${ids.bulkOne}, ${ids.bulkTwo}]) {
                const checkbox = document.querySelector('tr[data-notification-id="' + id + '"] .row-notification-checkbox');
                checkbox.checked = true;
                checkbox.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return true;
        })()`);
        assert(!(await evaluate(`document.getElementById('deleteSelectedButton').disabled`)), 'Delete Selected stayed disabled.');
        await evaluate(`document.getElementById('deleteSelectedButton').click(); true`);
        await evaluate(`document.getElementById('confirmDeleteButton').click(); true`);
        await waitFor(`!${rowExists(ids.bulkOne)} && !${rowExists(ids.bulkTwo)}`);
        results.push('delete selected: PASS');

        const allCancelStart = deleteRequests;
        await evaluate(`document.getElementById('deleteAllButton').click(); true`);
        assert(await evaluate(`/including read and unread/i.test(document.getElementById('deleteModalMessage').textContent)`), 'Delete All warning is unclear.');
        await evaluate(`document.getElementById('cancelDeleteButton').click(); true`);
        assert(deleteRequests === allCancelStart, 'Cancel Delete All sent a request.');
        results.push('delete all confirmation cancel: PASS');

        await evaluate(`document.getElementById('unreadOnlyButton').click(); true`);
        await waitFor(rowExists(ids.unread));
        assert(!(await evaluate(rowExists(ids.read))), 'Unread Only displayed a read notification.');
        results.push('unread-only filter: PASS');

        await cdp.send('Emulation.setDeviceMetricsOverride', {
            width: 390,
            height: 844,
            deviceScaleFactor: 1,
            mobile: false
        });
        const mobileLoaded = cdp.once('Page.loadEventFired');
        await cdp.send('Page.reload', { ignoreCache: true });
        await mobileLoaded;
        await waitFor(rowExists(ids.unread));
        const mobileState = await evaluate(`(() => ({
            viewport: window.innerWidth,
            controlsVisible: ['selectAllNotifications', 'deleteSelectedButton', 'deleteAllButton'].every(id => {
                const element = document.getElementById(id);
                return element && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
            }),
            bodyOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
            documentWidth: document.documentElement.scrollWidth,
            offenders: [...document.querySelectorAll('body *')].map(element => {
                const rect = element.getBoundingClientRect();
                return { tag: element.tagName, id: element.id, className: String(element.className || ''), right: Math.round(rect.right), width: Math.round(rect.width) };
            }).filter(item => item.right > document.documentElement.clientWidth + 2).slice(0, 8)
        }))()`);
        assert(
            mobileState.viewport === 390 && mobileState.controlsVisible && !mobileState.bodyOverflow,
            `Mobile controls overflow or are not visible: ${JSON.stringify(mobileState)}`
        );
        results.push('mobile viewport: PASS');

        await evaluate(`notifications = []; selectedNotificationIds.clear(); currentUnreadOnly = false; renderNotifications(); true`);
        assert(await evaluate(`/No notifications found/i.test(document.getElementById('notificationsTableBody').textContent)`), 'Empty state did not render.');
        results.push('empty state: PASS');

        const reloaded = cdp.once('Page.loadEventFired');
        await cdp.send('Page.reload', { ignoreCache: true });
        await reloaded;
        await waitFor(`document.querySelectorAll('#notificationsTableBody tr').length > 0`);
        assert(!(await evaluate(rowExists(ids.one))), 'Deleted notification returned after refresh.');
        assert(!(await evaluate(rowExists(ids.double))), 'Double-deleted notification returned after refresh.');
        assert(browserErrors.length === 0, `Browser console/runtime error: ${browserErrors[0]}`);
        results.push('refresh persistence and console: PASS');

        results.forEach((result) => console.log(result));
    } finally {
        if (cdp) cdp.close();
        if (admin) {
            await db.query(
                'DELETE FROM notifications WHERE user_id = ? AND reference_type = ? AND reference_id = ?',
                [admin.id, fixtureType, runId]
            );
        }
        await db.end();
    }
}

main().catch((error) => {
    console.error(`Notification browser test failed: ${error.message}`);
    process.exitCode = 1;
});
