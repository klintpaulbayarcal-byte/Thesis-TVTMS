const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('report RPCs preserve collected revenue, aliases and server-only access', async () => {
    const db = new PGlite();
    try {
        await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
        await db.exec(fs.readFileSync(path.join(__dirname, '../models/database.postgres.sql'), 'utf8'));
        await db.exec(fs.readFileSync(path.join(__dirname, '../../supabase/migrations/202609120001_api_access.sql'), 'utf8'));
        await db.exec(fs.readFileSync(path.join(__dirname, '../../supabase/migrations/202609120005_reports.sql'), 'utf8'));
        await db.exec(`insert into public.users(id,name,email,password,role) values(101,'Test','test@example.invalid','unused','apprehending_officer');
            insert into public.vehicles(id,plate_number,vehicle_type) values(101,'TEST-101','car');
            insert into public.tickets(id,ticket_number,user_id,vehicle_id,violation_id,date_issued,time_issued) values(101,'TEST',101,101,1,'2026-09-01','10:00');
            insert into public.payments(ticket_id,amount_paid,official_receipt_number,payment_status,payment_date) values
            (101,100,'TEST-1','partial','2026-09-01'),(101,200,'TEST-2','voided','2026-09-01');`);
        const revenue = await db.query(`select public.tvtms_report_revenue('["2026-09-01","2026-09-30"]') as value`);
        assert.equal(Number(revenue.rows[0].value[0].total), 100);
        const chart = await db.query(`select public.tvtms_report_collection_totals('["2026-09-01","2026-09-30"]') as value`);
        assert.equal(Number(chart.rows[0].value[0].totalAmount), 100);
        assert.equal(Number(chart.rows[0].value[0].paymentCount), 1);
        const permissions = await db.query(`select has_function_privilege('anon','public.tvtms_report_revenue(jsonb)','execute') as anon,
            has_function_privilege('service_role','public.tvtms_report_revenue(jsonb)','execute') as backend`);
        assert.deepEqual(permissions.rows[0], { anon: false, backend: true });
        const functions = (await db.query(`select proname from pg_proc join pg_namespace n on n.oid=pronamespace
            where n.nspname='public' and proname like 'tvtms_report_%' order by proname`)).rows;
        await db.exec('set role service_role');
        for (const { proname } of functions) {
            const args = ['tvtms_report_monthly_tickets'].includes(proname) ? [2026, 9]
                : ['tvtms_report_yearly_tickets', 'tvtms_report_yearly_revenue'].includes(proname) ? [2026]
                : ['2026-09-01', '2026-09-30'];
            const result = await db.query(`select public.${proname}($1::jsonb) as value`, [JSON.stringify(args)]);
            assert.ok(Array.isArray(result.rows[0].value), proname);
        }
    } finally { await db.close(); }
});
