const assert = require('node:assert/strict');
const db = require('../config/database');
const publicController = require('../controllers/publicController');

const originalQuery = db.query;
const originalGetConnection = db.getConnection;

const response = () => ({
    statusCode: 200,
    body: null,
    status(code) {
        this.statusCode = code;
        return this;
    },
    json(payload) {
        this.body = payload;
        return this;
    }
});

const invoke = async (handler, { query = {}, body = {} } = {}) => {
    const res = response();
    await handler({ query, body }, res);
    return res;
};

const makeConnection = ({ ticket, ageDays = 1, existing = [] }) => {
    const state = {
        began: 0,
        committed: 0,
        rolledBack: 0,
        released: 0,
        disputeInsert: null
    };
    const connection = {
        async beginTransaction() { state.began += 1; },
        async commit() { state.committed += 1; },
        async rollback() { state.rolledBack += 1; },
        release() { state.released += 1; },
        async query(sql, params = []) {
            if (/FROM tickets t[\s\S]+FOR UPDATE/i.test(sql)) return [[ticket].filter(Boolean)];
            if (/SELECT DATEDIFF/i.test(sql)) return [[{ age_days: ageDays }]];
            if (/SELECT id FROM disputes/i.test(sql)) return [existing];
            if (/INSERT INTO disputes/i.test(sql)) {
                state.disputeInsert = params;
                return [{ insertId: 501, affectedRows: 1 }];
            }
            if (/INSERT INTO notifications/i.test(sql)) return [{ affectedRows: 1 }];
            throw new Error(`Unexpected SQL in test: ${sql}`);
        }
    };
    return { connection, state };
};

async function testSafeMultipleTicketLookup() {
    db.query = async (sql, params) => {
        assert.match(sql, /FROM ticket_details td/);
        assert.deepEqual(params, ['ABC1234']);
        return [[
            {
                id: 11,
                ticket_number: 'TVT-2026-0011',
                plate_number: 'ABC1234',
                vehicle_type: 'car',
                violation_code: 'V001',
                violation_name: 'No Helmet',
                status: 'unpaid',
                dispute_age_days: 2,
                dispute_deadline_days: 15,
                has_open_dispute: 0
            },
            {
                id: 12,
                ticket_number: 'TVT-2026-0012',
                plate_number: 'ABC1234',
                vehicle_type: 'car',
                violation_code: 'V004',
                violation_name: 'Overspeeding',
                status: 'unpaid',
                dispute_age_days: 3,
                dispute_deadline_days: 15,
                has_open_dispute: 1
            }
        ]];
    };

    const res = await invoke(publicController.publicTicketLookup, { query: { plate: 'abc-1234' } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.count, 2);
    assert.equal(res.body.tickets[0].dispute_eligible, true);
    assert.equal(res.body.tickets[1].dispute_eligible, false);
    assert.match(res.body.tickets[1].dispute_message, /already open/i);

    for (const ticket of res.body.tickets) {
        for (const privateField of ['id', 'owner_name', 'owner_email', 'owner_address', 'contact_name', 'contact_email',
            'dispute_age_days', 'dispute_deadline_days', 'has_open_dispute']) {
            assert.equal(Object.hasOwn(ticket, privateField), false, `${privateField} must not be public`);
        }
    }
}

async function testBackendOwnedContactDetails() {
    const { connection, state } = makeConnection({
        ticket: {
            id: 21,
            status: 'unpaid',
            date_issued: '2026-08-13',
            deadline_days: 15,
            contact_name: 'Stored Driver',
            contact_email: 'stored@example.test'
        }
    });
    db.getConnection = async () => connection;

    const res = await invoke(publicController.publicFileDispute, {
        body: {
            ticket_number: 'tvt-2026-0021',
            reason: 'This ticket was issued to the wrong vehicle.',
            contact_name: 'Injected Name',
            contact_email: 'attacker@example.test'
        }
    });

    assert.equal(res.statusCode, 201);
    assert.deepEqual(state.disputeInsert, [21, 'Stored Driver', 'stored@example.test', 'This ticket was issued to the wrong vehicle.']);
    assert.equal(state.committed, 1);
    assert.equal(state.rolledBack, 0);
    assert.equal(state.released, 1);
}

async function testDuplicateIsRejected() {
    const { connection, state } = makeConnection({
        ticket: { id: 22, status: 'unpaid', date_issued: '2026-08-13', deadline_days: 15, contact_name: 'Driver', contact_email: null },
        existing: [{ id: 90 }]
    });
    db.getConnection = async () => connection;

    const res = await invoke(publicController.publicFileDispute, {
        body: { ticket_number: 'TVT-2026-0022', reason: 'This is a duplicate prevention test only.' }
    });
    assert.equal(res.statusCode, 409);
    assert.equal(state.disputeInsert, null);
    assert.equal(state.rolledBack, 1);
    assert.equal(state.released, 1);
}

async function testMissingStoredIdentityRemainsPrivate() {
    const { connection, state } = makeConnection({
        ticket: { id: 26, status: 'unpaid', date_issued: '2026-08-13', deadline_days: 15, contact_name: null, contact_email: null }
    });
    db.getConnection = async () => connection;

    const res = await invoke(publicController.publicFileDispute, {
        body: { ticket_number: 'TVT-2026-0026', reason: 'The stored ticket identity is intentionally absent.' }
    });
    assert.equal(res.statusCode, 201);
    assert.deepEqual(state.disputeInsert, [26, null, null, 'The stored ticket identity is intentionally absent.']);
}

async function testIneligibleTicketsAreRejected() {
    let mock = makeConnection({
        ticket: { id: 23, status: 'paid', date_issued: '2026-08-13', deadline_days: 15, contact_name: 'Driver', contact_email: null }
    });
    db.getConnection = async () => mock.connection;
    let res = await invoke(publicController.publicFileDispute, {
        body: { ticket_number: 'TVT-2026-0023', reason: 'Paid tickets must not accept a dispute.' }
    });
    assert.equal(res.statusCode, 403);
    assert.equal(mock.state.disputeInsert, null);

    mock = makeConnection({
        ticket: { id: 24, status: 'unpaid', date_issued: '2026-06-01', deadline_days: 15, contact_name: 'Driver', contact_email: null },
        ageDays: 16
    });
    db.getConnection = async () => mock.connection;
    res = await invoke(publicController.publicFileDispute, {
        body: { ticket_number: 'TVT-2026-0024', reason: 'Expired tickets must not accept a dispute.' }
    });
    assert.equal(res.statusCode, 403);
    assert.match(res.body.message, /period has ended/i);
    assert.equal(mock.state.disputeInsert, null);
}

async function testInvalidReasonDoesNotOpenDatabaseConnection() {
    let connectionRequested = false;
    db.getConnection = async () => {
        connectionRequested = true;
        throw new Error('Database connection should not be requested');
    };
    const res = await invoke(publicController.publicFileDispute, {
        body: { ticket_number: 'TVT-2026-0025', reason: 'short' }
    });
    assert.equal(res.statusCode, 400);
    assert.equal(connectionRequested, false);
}

async function run() {
    try {
        await testSafeMultipleTicketLookup();
        await testBackendOwnedContactDetails();
        await testDuplicateIsRejected();
        await testMissingStoredIdentityRemainsPrivate();
        await testIneligibleTicketsAreRejected();
        await testInvalidReasonDoesNotOpenDatabaseConnection();
        console.log('Public dispute flow tests passed (6 scenarios, no real database writes).');
    } finally {
        db.query = originalQuery;
        db.getConnection = originalGetConnection;
    }
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
