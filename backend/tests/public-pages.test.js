const test = require('node:test');
const assert = require('node:assert/strict');

test('public pages load their scripts under the response CSP without inline execution', async () => {
    process.env.NODE_ENV = 'development';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_test_only';
    const app = require('../server');
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        for (const page of ['landing', 'login', 'public-ticket-lookup', 'admin-dashboard', 'officer-dashboard']) {
            const url = `${base}/pages/${page}.html`;
            const response = await fetch(url);
            assert.equal(response.status, 200);
            const csp = response.headers.get('content-security-policy');
            assert.match(csp, /script-src 'self'(?:;|$)/);
            assert.match(csp, /script-src-attr 'none'/);
            assert.ok(!csp.includes('upgrade-insecure-requests'), 'local HTTP must stay usable');
            const html = await response.text();
            for (const [, attributes, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
                const src = attributes.match(/\bsrc="([^"]+)"/);
                assert.ok(src, `${page}: executable inline script blocked by CSP`);
                assert.equal(body.trim(), '');
                const scriptUrl = new URL(src[1], url);
                assert.equal(scriptUrl.origin, base, `${page}: script must be served locally`);
                assert.equal((await fetch(scriptUrl)).status, 200, scriptUrl.pathname);
            }
            assert.doesNotMatch(html, /\son\w+\s*=/i, `${page}: inline event handlers blocked by CSP`);
        }
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});
