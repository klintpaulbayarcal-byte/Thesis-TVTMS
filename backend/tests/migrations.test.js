const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('all migrations compose and preserve the server-only access boundary', async () => {
    const db = new PGlite();
    try {
        await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
        await db.exec(fs.readFileSync(path.join(__dirname, '../models/database.postgres.sql'), 'utf8'));
        const dir = path.join(__dirname, '../../supabase/migrations');
        for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
            await db.exec(fs.readFileSync(path.join(dir, file), 'utf8'));
        }
        const tables = (await db.query(`select c.relname, c.relrowsecurity,
            has_table_privilege('anon',c.oid,'SELECT') as anon,
            has_table_privilege('authenticated',c.oid,'SELECT') as authenticated,
            has_table_privilege('service_role',c.oid,'SELECT') as backend
            from pg_class c join pg_namespace n on n.oid=c.relnamespace
            where n.nspname='public' and c.relkind='r'`)).rows;
        assert.equal(tables.length, 15);
        for (const table of tables) {
            assert.equal(table.relrowsecurity, true, table.relname);
            assert.equal(table.anon, false, table.relname);
            assert.equal(table.authenticated, false, table.relname);
            assert.equal(table.backend, true, table.relname);
        }
        const functions = (await db.query(`select p.proname,
            has_function_privilege('anon',p.oid,'EXECUTE') as anon,
            has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated,
            has_function_privilege('service_role',p.oid,'EXECUTE') as backend
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname like 'tvtms_%'`)).rows;
        assert.ok(functions.length > 0);
        for (const fn of functions) {
            assert.equal(fn.anon, false, fn.proname);
            assert.equal(fn.authenticated, false, fn.proname);
            assert.equal(fn.backend, true, fn.proname);
        }
        await db.exec('set role service_role');
        await db.exec("update public.system_settings set setting_value=setting_value where setting_key='lgu_name'");
        assert.equal((await db.query('select count(*) from public.violations')).rows[0].count, 15);
    } finally { await db.close(); }
});
