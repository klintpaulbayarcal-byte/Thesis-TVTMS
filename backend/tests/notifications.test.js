const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function fixture(rows) {
    const supabase = { from() {
        const filters = []; let operation = 'select'; let values; let exact = false; let limit = Infinity;
        const q = {
            select(columns, options = {}) { exact ||= options.count === 'exact'; return this; },
            delete(options = {}) { operation = 'delete'; exact = options.count === 'exact'; return this; },
            update(data, options = {}) { operation = 'update'; values = data; exact = options.count === 'exact'; return this; },
            eq(key, value) { filters.push(row => row[key] === value); return this; },
            in(key, value) { filters.push(row => value.includes(row[key])); return this; },
            order() { return this; }, limit(value) { limit = value; return this; },
            then(resolve, reject) {
                const matches = rows.filter(row => filters.every(fn => fn(row)));
                if (operation === 'delete') for (const row of matches) rows.splice(rows.indexOf(row), 1);
                if (operation === 'update') for (const row of matches) Object.assign(row, values);
                return Promise.resolve({ data: matches.slice(0, limit), error: null, count: exact ? matches.length : null }).then(resolve, reject);
            }
        };
        return q;
    } };
    const exports = {};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controllers/notificationController.js'), 'utf8'), {
        exports, console: { error() {} }, require(name) {
            if (name === '../config/supabase') return { supabase, run: async q => (await q).data };
            return require('../utils/apiResponse');
        }
    });
    const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
    return { controller: exports, response };
}

test('notification deletion respects ownership and repeated deletion returns 404', async () => {
    const rows = [{ id: 1, user_id: 7 }, { id: 2, user_id: 8 }];
    const { controller, response } = fixture(rows);
    let res = response();
    await controller.deleteNotification({ user: { id: 7 }, params: { id: 2 } }, res);
    assert.equal(res.code, 404);
    assert.equal(rows.length, 2);
    res = response();
    await controller.deleteNotification({ user: { id: 7 }, params: { id: 1 } }, res);
    assert.equal(res.code, 200);
    assert.equal(rows.length, 1);
    res = response();
    await controller.deleteNotification({ user: { id: 7 }, params: { id: 1 } }, res);
    assert.equal(res.code, 404);
});

test('bulk deletion excludes other users and delete-all reports counts above the API row cap', async () => {
    const rows = Array.from({ length: 1201 }, (_, id) => ({ id: id + 1, user_id: 7 }));
    rows.push({ id: 2000, user_id: 8 });
    const { controller, response } = fixture(rows);
    let res = response();
    await controller.deleteNotificationsBulk({ user: { id: 7 }, body: { ids: [1, 2000] } }, res);
    assert.equal(res.body.data.deletedCount, 1);
    res = response();
    await controller.deleteAllNotifications({ user: { id: 7 } }, res);
    assert.equal(res.body.data.deletedCount, 1200);
    assert.deepEqual(rows, [{ id: 2000, user_id: 8 }]);
});

test('listing limits visible rows while counts cover all owned notifications', async () => {
    const rows = [{ id: 1, user_id: 7, is_read: 0 }, { id: 2, user_id: 7, is_read: 1 }, { id: 3, user_id: 8, is_read: 0 }];
    const { controller, response } = fixture(rows);
    const res = response();
    await controller.getMyNotifications({ user: { id: 7 }, query: { limit: 1 } }, res);
    assert.equal(res.body.notifications.length, 1);
    assert.equal(res.body.totalCount, 2);
    assert.equal(res.body.unreadCount, 1);
});
