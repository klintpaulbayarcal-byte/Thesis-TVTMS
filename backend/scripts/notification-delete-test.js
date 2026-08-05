const assert = require('assert');
const jwt = require('jsonwebtoken');
require('dotenv').config({ quiet: true });

const db = require('../config/database');
const notificationController = require('../controllers/notificationController');

const API_BASE_URL = 'http://localhost:5000/api';
const fixtureType = 'notification_delete_test';
const runId = Math.floor(Date.now() / 1000);

const request = async (token, path, options = {}) => {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });
    const body = await response.json();
    return { status: response.status, body };
};

const createToken = (user) => jwt.sign({
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name
}, process.env.JWT_SECRET, { expiresIn: '10m' });

const insertFixture = async (userId, title, isRead = 0) => {
    const [result] = await db.query(
        `INSERT INTO notifications
            (user_id, type, title, message, is_read, read_at, reference_type, reference_id)
         VALUES (?, ?, ?, ?, ?, IF(? = 1, NOW(), NULL), ?, ?)`,
        [userId, fixtureType, title, 'Automated notification deletion validation.', isRead, isRead, fixtureType, runId]
    );
    return result.insertId;
};

const testDeleteAllControllerQuery = async (userId, expectedCount) => {
    const originalQuery = db.query;
    let responseStatus;
    let responseBody;
    const connection = await db.getConnection();

    const res = {
        status(code) {
            responseStatus = code;
            return this;
        },
        json(body) {
            responseBody = body;
            return body;
        }
    };

    try {
        await connection.beginTransaction();
        db.query = connection.query.bind(connection);
        await notificationController.deleteAllNotifications({ user: { id: userId } }, res);
        const [[insideTransaction]] = await connection.query(
            'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ?',
            [userId]
        );
        assert.strictEqual(Number(insideTransaction.count), 0);
        await connection.rollback();
    } finally {
        db.query = originalQuery;
        try {
            await connection.rollback();
        } catch (error) {
            // The transaction may already have been rolled back successfully.
        }
        connection.release();
    }

    assert.strictEqual(responseStatus, 200);
    assert.strictEqual(responseBody.data.deletedCount, expectedCount);

    const [[afterRollback]] = await db.query(
        'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ?',
        [userId]
    );
    assert.strictEqual(Number(afterRollback.count), expectedCount);
};

const main = async () => {
    const results = [];
    let admin;
    let officer;

    try {
        const [users] = await db.query(
            `SELECT id, name, email, role
             FROM users
             WHERE status = 'active' AND role IN ('admin', 'apprehending_officer')
             ORDER BY role, id`
        );
        admin = users.find((user) => user.role === 'admin');
        officer = users.find((user) => user.role === 'apprehending_officer');
        assert(admin && officer, 'An active administrator and officer are required for ownership tests.');

        const [[adminBaseline]] = await db.query(
            'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ?',
            [admin.id]
        );
        const [[officerBaseline]] = await db.query(
            'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ?',
            [officer.id]
        );

        const adminToken = createToken(admin);
        const officerToken = createToken(officer);
        const oneId = await insertFixture(admin.id, `Delete one ${runId}`);
        const bulkId1 = await insertFixture(admin.id, `Bulk one ${runId}`);
        const bulkId2 = await insertFixture(admin.id, `Bulk two ${runId}`, 1);
        const doubleId = await insertFixture(admin.id, `Double click ${runId}`);
        const officerId = await insertFixture(officer.id, `Ownership ${runId}`);

        const deleteOne = await request(adminToken, `/notifications/${oneId}`, { method: 'DELETE' });
        assert.strictEqual(deleteOne.status, 200, `delete one returned ${deleteOne.status}: ${deleteOne.body.message || 'no message'}`);
        assert.strictEqual(deleteOne.body.data.deletedCount, 1);
        results.push('delete one: PASS');

        const crossOwner = await request(adminToken, `/notifications/${officerId}`, { method: 'DELETE' });
        assert.strictEqual(crossOwner.status, 404, `cross-owner delete returned ${crossOwner.status}`);
        const [[officerFixtureStillExists]] = await db.query(
            'SELECT COUNT(*) AS count FROM notifications WHERE id = ? AND user_id = ?',
            [officerId, officer.id]
        );
        assert.strictEqual(Number(officerFixtureStillExists.count), 1);
        results.push('another-user deletion blocked: PASS');

        const bulkDelete = await request(adminToken, '/notifications/bulk', {
            method: 'DELETE',
            body: JSON.stringify({ ids: [bulkId1, bulkId2, officerId] })
        });
        assert.strictEqual(bulkDelete.status, 200, `bulk delete returned ${bulkDelete.status}: ${bulkDelete.body.message || 'no message'}`);
        assert.strictEqual(bulkDelete.body.data.deletedCount, 2);
        results.push('bulk delete and ownership scope: PASS');

        const doubleDelete = await Promise.all([
            request(adminToken, `/notifications/${doubleId}`, { method: 'DELETE' }),
            request(adminToken, `/notifications/${doubleId}`, { method: 'DELETE' })
        ]);
        assert.deepStrictEqual(doubleDelete.map((result) => result.status).sort(), [200, 404]);
        results.push('concurrent double delete: PASS');

        const refreshed = await request(adminToken, '/notifications?limit=200');
        const refreshedIds = (refreshed.body.notifications || []).map((item) => Number(item.id));
        assert(!refreshedIds.includes(oneId));
        assert(!refreshedIds.includes(bulkId1));
        assert(!refreshedIds.includes(bulkId2));
        assert(!refreshedIds.includes(doubleId));
        results.push('refresh persistence and counts response: PASS');

        const invalidBulk = await request(adminToken, '/notifications/bulk', {
            method: 'DELETE',
            body: JSON.stringify({ ids: [0, 'invalid'] })
        });
        assert.strictEqual(invalidBulk.status, 400);
        results.push('invalid bulk input rejected: PASS');

        const officerCleanup = await request(officerToken, `/notifications/${officerId}`, { method: 'DELETE' });
        assert.strictEqual(officerCleanup.status, 200);

        await testDeleteAllControllerQuery(admin.id, Number(adminBaseline.count));
        results.push('delete all authenticated-user transaction rollback: PASS');

        const [[adminAfter]] = await db.query(
            'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ?',
            [admin.id]
        );
        const [[officerAfter]] = await db.query(
            'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ?',
            [officer.id]
        );
        assert.strictEqual(Number(adminAfter.count), Number(adminBaseline.count));
        assert.strictEqual(Number(officerAfter.count), Number(officerBaseline.count));
        results.push('existing notification counts preserved: PASS');

        results.forEach((result) => console.log(result));
    } finally {
        if (admin || officer) {
            const userIds = [admin && admin.id, officer && officer.id].filter(Boolean);
            if (userIds.length > 0) {
                const placeholders = userIds.map(() => '?').join(', ');
                await db.query(
                    `DELETE FROM notifications
                     WHERE reference_type = ? AND reference_id = ? AND user_id IN (${placeholders})`,
                    [fixtureType, runId, ...userIds]
                );
            }
        }
        await db.end();
    }
};

main().catch((error) => {
    console.error(`Notification deletion test failed: ${error.message}`);
    process.exitCode = 1;
});
