const test = require('node:test');
const assert = require('node:assert/strict');
const { readSupabaseConfig } = require('../config/supabase-settings');
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_test_only';

test('server configuration rejects publishable credentials and missing URLs', () => {
    assert.throws(() => readSupabaseConfig({}), /SUPABASE_URL/);
    assert.throws(() => readSupabaseConfig({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_publishable_public' }), /secret/i);
});

test('server configuration uses HTTPS API credentials without a database password', () => {
    assert.deepEqual(readSupabaseConfig({ SUPABASE_URL: 'https://example.supabase.co/', SUPABASE_SECRET_KEY: 'sb_secret_server' }), {
        url: 'https://example.supabase.co', key: 'sb_secret_server'
    });
});

test('Supabase errors remain exceptions and retain duplicate-key compatibility', async () => {
    const { run } = require('../config/supabase');
    await assert.rejects(run(Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate' } })), { code: 'ER_DUP_ENTRY' });
    assert.deepEqual(await run(Promise.resolve({ data: [{ id: 2 }], error: null })), [{ id: 2 }]);
});

test('full reads paginate through the API row limit', async () => {
    const { allRows } = require('../config/supabase');
    const rows = Array.from({ length: 1101 }, (_, id) => ({ id }));
    const result = await allRows(() => ({ range: (start, end) => Promise.resolve({ data: rows.slice(start, end + 1), error: null }) }));
    assert.equal(result.length, 1101);
    assert.equal(result[1100].id, 1100);
});
