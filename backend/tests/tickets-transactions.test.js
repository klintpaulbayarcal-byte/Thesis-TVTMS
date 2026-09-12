const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '../..');

test('ticket RPCs preserve snapshots, escalation, payment protections and rollback', async () => {
    const db = new PGlite();
    try {
        await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
        for (const file of ['backend/models/database.postgres.sql', 'supabase/migrations/202609120001_api_access.sql', 'supabase/migrations/202609120002_tickets.sql']) {
            await db.exec(fs.readFileSync(path.join(root, file), 'utf8'));
        }
        await db.exec("insert into public.users(id,name,email,password,role) values (1,'Admin','admin@test.test','hash','admin'),(2,'Officer','officer@test.test','hash','apprehending_officer'); set role service_role;");
        const call = async (fn, args) => (await db.query(`select public.${fn}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as result`, args)).rows[0].result;
        const issue = (data = {}) => call('tvtms_ticket_create', [JSON.stringify({ plate_number: 'AB123', vehicle_type: 'car', violation_id: 1, owner_name: 'First Owner', ...data }), 2]);
        const mutate = (id, action, data, role = 'admin', user = 1) => call('tvtms_ticket_mutate', [action, id, user, role, JSON.stringify(data)]);
        const first = await issue();
        assert.equal(first.ticket.owner_name, 'First Owner');
        assert.equal(first.penaltyInfo.nextOffenseCount, 1);
        await db.exec("insert into public.violation_penalty_rules(violation_id,offense_count,penalty_amount,effective_from) values(1,2,750,current_date - 1);");
        const second = await issue({ owner_name: 'Second Owner' });
        assert.equal(second.penaltyInfo.effectivePenalty, 750);
        assert.equal(second.penaltyInfo.nextOffenseCount, 2);
        assert.notEqual(first.ticket.ticket_number, second.ticket.ticket_number);
        const detail = await call('tvtms_ticket_detail', [first.ticket.id]);
        assert.equal(detail.owner_name, 'First Owner');
        assert.deepEqual(detail.timeline.map(row => row.new_status), ['draft', 'issued']);
        const denied = await mutate(first.ticket.id, 'details', { location: 'Changed' }, 'apprehending_officer', 1);
        assert.equal(denied.error.errorCode, 'TICKET_ACCESS_DENIED');
        await db.query("insert into public.payments(ticket_id,amount_paid,official_receipt_number,payment_date) values($1,500,'OR-1',current_date)", [first.ticket.id]);
        assert.equal((await mutate(first.ticket.id, 'cancel', { reason: 'test reason' })).error.errorCode, 'PAYMENT_EXISTS');
        assert.equal((await mutate(first.ticket.id, 'delete', { reason: 'test reason' })).error.errorCode, 'LINKED_RECORDS_EXIST');
        await db.query("update public.tickets set status='paid' where id=$1", [first.ticket.id]);
        const corrected = await mutate(first.ticket.id, 'unpaid', { reason: 'Incorrect payment' });
        assert.equal(corrected.voidedPayments, 1);
        assert.equal((await db.query('select payment_status from public.payments')).rows[0].payment_status, 'voided');
        assert.equal((await mutate(first.ticket.id, 'cancel', { reason: 'test reason' })).ticket.status, 'cancelled');
        assert.equal((await mutate(second.ticket.id, 'status', { status: 'closed' })).error.errorCode, 'INVALID_STATUS_TRANSITION');
        const countBefore = (await db.query('select count(*)::int as n from public.tickets')).rows[0].n;
        await assert.rejects(call('tvtms_ticket_create', [JSON.stringify({ plate_number: 'ROLLBACK', vehicle_type: 'car', violation_id: 1 }), 999]), /foreign key/);
        assert.equal((await db.query('select count(*)::int as n from public.tickets')).rows[0].n, countBefore);
        assert.equal((await db.query("select count(*)::int as n from public.vehicles where plate_number='ROLLBACK'")).rows[0].n, 0);
        const listing = await call('tvtms_ticket_list', [JSON.stringify({ officerId: 2, enforcerId: 1, pageSize: 20 })]);
        assert.equal(listing.total, 0);
        const search = await call('tvtms_ticket_list', [JSON.stringify({ search: 'first owner', pageSize: 20 })]);
        assert.equal(search.total, 1);
        const stats = await call('tvtms_ticket_stats', [2]);
        assert.equal(stats.total, 2);
        assert.equal(stats.revenue, 0);
        await db.exec('reset role; set role anon;');
        await assert.rejects(call('tvtms_ticket_stats', [null]), /permission denied/);
    } finally { await db.close(); }
});
