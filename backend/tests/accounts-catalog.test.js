const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('account transactions preserve administrators, history, reset tokens and provisioning roles', async () => {
    const db = new PGlite();
    const call = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as result`, args)).rows[0].result;
    try {
        await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
        await db.exec(fs.readFileSync(path.join(__dirname, '../models/database.postgres.sql'), 'utf8'));
        for (const file of ['202609120001_api_access.sql', '202609120004_accounts_catalog.sql']) {
            await db.exec(fs.readFileSync(path.join(__dirname, '../../supabase/migrations', file), 'utf8'));
        }
        await db.exec("insert into public.users(id,name,email,password,role) values (1,'Admin','admin@example.com','old-hash','admin'),(2,'Officer','officer@example.com','officer-hash','apprehending_officer'); set role service_role;");
        assert.equal((await call('tvtms_account_delete', [1])).status, 409);
        assert.equal((await call('tvtms_account_update', [1, 'Admin','admin@example.com','apprehending_officer',null,'active'])).status, 409);
        assert.match((await call('tvtms_account_provision_admin', ['officer@example.com',null,'new-hash'])).error, /belongs to role/);
        assert.equal((await db.query('select password from public.users where id=2')).rows[0].password,'officer-hash');
        await assert.rejects(call('tvtms_account_update',[1,'Changed','officer@example.com','admin',null,'active']), /unique/);
        assert.equal((await db.query('select name from public.users where id=1')).rows[0].name,'Admin');
        await db.exec("update public.users set reset_token_hash='token',reset_token_expires=now()+interval '1 hour' where id=2");
        assert.equal(await call('tvtms_account_reset_password',[2,'token','reset-hash']),true);
        assert.equal(await call('tvtms_account_reset_password',[2,'token','reused-hash']),false);
        assert.equal((await db.query('select password from public.users where id=2')).rows[0].password,'reset-hash');
        for(let i=0;i<5;i++) await call('tvtms_account_failed_login',[2,5,15]);
        const locked=(await db.query('select failed_login_attempts, locked_until>now() as locked from public.users where id=2')).rows[0];
        assert.deepEqual(locked,{failed_login_attempts:5,locked:true});
        await db.exec("insert into public.vehicles(id,plate_number,vehicle_type) values(1,'ABC-123','car'); insert into public.tickets(id,ticket_number,user_id,vehicle_id,violation_id,date_issued,time_issued) values(1,'T1',2,1,1,current_date,'12:00');");
        assert.match((await call('tvtms_account_delete',[2])).error,/1 ticket/);
        assert.equal((await call('tvtms_catalog_delete_violation',[1])).status,409);
        await db.exec("insert into public.users(id,name,email,password,role) values(3,'Other','other@example.com','hash','admin')");
        assert.deepEqual(await call('tvtms_account_update',[1,'Admin','admin@example.com','admin',null,'inactive']),{});
        assert.equal((await call('tvtms_account_delete',[3])).status,409);
        assert.equal((await call('tvtms_account_provision_admin',['admin@example.com',null,'new-hash'])).status,'UPDATED');
        assert.equal((await call('tvtms_account_delete',[3])).user.id,3);
    } finally { await db.close(); }
});

test('catalog functions preserve balances, escalation, search and histories above REST row limits', async () => {
    const db = new PGlite();
    const call = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as result`, args)).rows[0].result;
    try {
        await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
        await db.exec(fs.readFileSync(path.join(__dirname, '../models/database.postgres.sql'), 'utf8'));
        for (const file of ['202609120001_api_access.sql', '202609120004_accounts_catalog.sql']) await db.exec(fs.readFileSync(path.join(__dirname, '../../supabase/migrations', file), 'utf8'));
        await db.exec("insert into public.users(id,name,email,password,role) values(1,'Admin','a@example.com','hash','admin'); insert into public.vehicles(id,plate_number,vehicle_type,owner_name) values(1,'ABC-123','car','Owner'); insert into public.tickets(id,ticket_number,user_id,vehicle_id,violation_id,penalty_amount_at_issue,date_issued,time_issued) select n,'T'||n,1,1,1,100,current_date,'12:00' from generate_series(1,1001) n; insert into public.payments(ticket_id,amount_paid,official_receipt_number,payment_status,payment_date) values(1,30,'R1','partial',current_date),(1,90,'R2','voided',current_date); set role service_role;");
        const history=await call('tvtms_catalog_vehicle_violations',[1]);
        assert.equal(history.length,1001);
        assert.equal(history[0].remaining_balance,70);
        assert.equal(history[0].total_paid,30);
        const stats=await call('tvtms_catalog_vehicle_stats',[1]);
        assert.equal(stats.outstanding_balance,100070);
        assert.equal(stats.total_violations,1001);
        assert.equal((await call('tvtms_catalog_vehicle_by_plate',['ABC123']))[0].id,1);
        assert.equal((await call('tvtms_catalog_prior_offenses',[1,'ABC123'])).prior_count,1001);
        assert.equal((await call('tvtms_catalog_search_vehicles',[null,null,'ABC','car']))[0].violation_count,1001);
        assert.equal((await call('tvtms_catalog_search_vehicles',[null,'owner',null,'car']))[0].id,1);
        assert.equal((await call('tvtms_catalog_search_vehicles',[null,null,'oWnEr','car']))[0].id,1);
        assert.deepEqual(await call('tvtms_catalog_search_vehicles',[null,null,'ABC),id.gt.0','car']),[]);
        await db.exec("insert into public.violation_penalty_rules(violation_id,offense_count,penalty_amount,effective_from) values(1,1002,300,current_date)");
        assert.equal((await call('tvtms_catalog_penalty_rule',[1,1002]))[0].penalty_amount,300);
    } finally { await db.close(); }
});
