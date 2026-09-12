const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function controller(rpc) {
    const exports = {};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controllers/ticketController.js'), 'utf8'), {
        exports, console, require(name) {
            if (name === '../config/supabase') return { rpc };
            if (name === '../config/database') return {};
            if (name === '../utils/auditLogger') return { logAudit: async () => {} };
            if (name === '../utils/emailService') return { sendViolationNotice: async () => {} };
            return require('../utils/apiResponse');
        }
    });
    return exports;
}
function response() {
    return { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}
const user = { id: 7, role: 'apprehending_officer' };

test('issue normalizes identity fields and preserves created response', async () => {
    let args;
    const ticket = { id: 11, ticket_number: 'TVT-2026-000011' };
    const c = controller(async (name, input) => {
        assert.equal(name, 'tvtms_ticket_create'); args = input;
        return { ticket, penaltyInfo: { basePenalty: 500, effectivePenalty: 750, nextOffenseCount: 2, usedEscalationRule: true } };
    });
    const res = response();
    await c.createTicket({ user, body: { plate_number: ' ab- 123 ', vehicle_type: ' CAR ', violation_id: 2 } }, res);
    assert.equal(res.code, 201);
    assert.equal(args.p_data.plate_number, 'AB123');
    assert.equal(args.p_data.vehicle_type, 'car');
    assert.equal(res.body.ticket.ticket_number, ticket.ticket_number);
});

test('payment protection domain rejection retains cancellation HTTP contract', async () => {
    const c = controller(async () => ({ error: { message: 'Tickets with recorded payments cannot be cancelled', statusCode: 409, errorCode: 'PAYMENT_EXISTS' } }));
    const res = response();
    await c.deleteTicket({ user: { id: 1, role: 'admin' }, params: { id: '3' }, body: { reason: 'mistaken issue' }, query: {} }, res);
    assert.equal(res.code, 409);
    assert.equal(res.body.errorCode, 'PAYMENT_EXISTS');
});

test('officer ticket listing scopes even when another enforcer is requested', async () => {
    let filters;
    const c = controller(async (name, args) => { filters = args.p_filters; return { tickets: [], total: 0 }; });
    const res = response();
    await c.getAllTickets({ user, query: { enforcerId: '8', pageSize: '999', sortBy: 'unsafe' } }, res);
    assert.equal(res.code, 200);
    assert.equal(filters.officerId, 7);
    assert.equal(filters.enforcerId, '8');
    assert.equal(filters.pageSize, 100);
    assert.equal(filters.sortBy, 'date_issued');
});

test('status paid is rejected without accessing the database', async () => {
    const c = controller(async () => { assert.fail('unexpected database operation'); });
    const res = response();
    await c.updateTicketStatus({ user, params: { id: '3' }, body: { status: 'paid' } }, res);
    assert.equal(res.code, 409);
    assert.equal(res.body.errorCode, 'PAYMENT_REQUIRED');
});
