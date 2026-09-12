// Read-only integration checks against the locally running Express server.
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { supabase, run } = require('../config/supabase');

const base = `http://127.0.0.1:${Number(process.env.PORT || 5000)}/api`;
let checks = 0;
async function check(path, token, expectedStatus = 200) {
    const response = await fetch(`${base}${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(30000)
    });
    const body = await response.json();
    assert.equal(response.status, expectedStatus, `${path}: HTTP ${response.status}`);
    if (expectedStatus === 200) assert.equal(body.success, true, path);
    checks += 1;
    console.log(`PASS ${path} (${expectedStatus})`);
    return body;
}

(async () => {
    const health = await check('/health');
    assert.equal(health.database, 'connected');
    assert.equal(health.databaseClient, 'supabase');
    await check('/public/stats');
    await check('/public/violations');
    await check('/tickets', null, 401);
    for (const role of ['admin', 'apprehending_officer']) {
        const users = await run(supabase.from('users').select('id,role').eq('status', 'active').eq('role', role).order('id').limit(1));
        assert.ok(users.length, `An active ${role} is required for the read-only session checks.`);
        const token = jwt.sign({ id: users[0].id }, process.env.JWT_SECRET, { expiresIn: '5m' });
        for (const path of ['/auth/profile', '/tickets', '/tickets/stats', '/violations/active', '/vehicles/stats', '/notifications', '/disputes']) {
            await check(path, token);
        }
        if (role === 'admin') {
            for (const path of ['/users', '/system/settings', '/vehicles', '/reports/daily', '/reports/monthly', '/reports/yearly',
                '/reports/violations', '/reports/officers', '/reports/collections', '/reports/hotspots',
                '/reports/officer-performance', '/reports/aging', '/reports/barangay', '/reports/analytics/collections',
                '/reports/analytics/payment-status', '/reports/analytics/tickets-summary', '/reports/analytics/dispute-rate',
                '/reports/analytics/monthly-revenue']) await check(path, token);
        } else {
            await check('/users', token, 403);
            await check('/reports/daily', token, 403);
        }
        const tickets = await run(supabase.from('tickets').select('id').eq('user_id', users[0].id).order('id').limit(1));
        if (tickets.length) {
            await check(`/tickets/${tickets[0].id}`, token);
            await check(`/payments/ticket/${tickets[0].id}`, token);
            await check(`/evidence/ticket/${tickets[0].id}`, token);
        }
    }
    console.log(`Read-only Supabase smoke checks passed: ${checks}. No records were modified.`);
})().catch(error => {
    console.error(`Smoke check failed: ${error.message}`);
    process.exitCode = 1;
});
