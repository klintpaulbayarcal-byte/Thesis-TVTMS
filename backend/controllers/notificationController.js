const db = require('../config/database');
const { sendSuccess, sendError } = require('../utils/apiResponse');

exports.getMyNotifications = async (req, res) => {
    try {
        const { unreadOnly, limit = 50 } = req.query;
        const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

        let query = 'SELECT * FROM notifications WHERE user_id = ?';
        const params = [req.user.id];

        if (String(unreadOnly).toLowerCase() === 'true') {
            query += ' AND is_read = 0';
        }

        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(safeLimit);

        const [items] = await db.query(query, params);
        const [[counts]] = await db.query(
            `SELECT COUNT(*) AS total_count,
                    COALESCE(SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END), 0) AS unread_count
             FROM notifications
             WHERE user_id = ?`,
            [req.user.id]
        );

        const totalCount = Number(counts.total_count) || 0;
        const unreadCount = Number(counts.unread_count) || 0;

        return sendSuccess(res, 'Notifications fetched successfully', items, {
            legacy: {
                notifications: items,
                totalCount,
                unreadCount
            }
        });
    } catch (error) {
        console.error('Get notifications error:', error);

        if (error.code === 'ER_NO_SUCH_TABLE') {
            return sendSuccess(res, 'Notifications not available yet', [], {
                legacy: {
                    notifications: []
                }
            });
        }

        return sendError(res, 'Server error while fetching notifications', {
            statusCode: 500,
            errorCode: 'NOTIFICATIONS_FETCH_FAILED'
        });
    }
};

const parseNotificationId = (value) => {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
};

exports.markNotificationAsRead = async (req, res) => {
    try {
        const id = parseNotificationId(req.params.id);

        if (!id) {
            return sendError(res, 'A valid notification ID is required', {
                statusCode: 400,
                errorCode: 'INVALID_NOTIFICATION_ID'
            });
        }

        const [result] = await db.query(
            'UPDATE notifications SET is_read = 1, read_at = NOW() WHERE id = ? AND user_id = ?',
            [id, req.user.id]
        );

        if (result.affectedRows === 0) {
            return sendError(res, 'Notification not found', {
                statusCode: 404,
                errorCode: 'NOTIFICATION_NOT_FOUND'
            });
        }

        return sendSuccess(res, 'Notification marked as read', { id: Number(id) });
    } catch (error) {
        console.error('Mark notification error:', error);
        return sendError(res, 'Server error while updating notification', {
            statusCode: 500,
            errorCode: 'NOTIFICATION_UPDATE_FAILED'
        });
    }
};

exports.deleteNotification = async (req, res) => {
    try {
        const id = parseNotificationId(req.params.id);

        if (!id) {
            return sendError(res, 'A valid notification ID is required', {
                statusCode: 400,
                errorCode: 'INVALID_NOTIFICATION_ID'
            });
        }

        const [result] = await db.query(
            'DELETE FROM notifications WHERE id = ? AND user_id = ?',
            [id, req.user.id]
        );

        if (result.affectedRows === 0) {
            return sendError(res, 'Notification not found', {
                statusCode: 404,
                errorCode: 'NOTIFICATION_NOT_FOUND'
            });
        }

        return sendSuccess(res, 'Notification deleted successfully', {
            deletedCount: 1,
            ids: [id]
        });
    } catch (error) {
        console.error('Delete notification error:', error);
        return sendError(res, 'Server error while deleting notification', {
            statusCode: 500,
            errorCode: 'NOTIFICATION_DELETE_FAILED'
        });
    }
};

exports.deleteNotificationsBulk = async (req, res) => {
    try {
        const requestedIds = req.body && req.body.ids;

        if (!Array.isArray(requestedIds) || requestedIds.length === 0 || requestedIds.length > 200) {
            return sendError(res, 'Select between 1 and 200 notifications to delete', {
                statusCode: 400,
                errorCode: 'INVALID_NOTIFICATION_IDS'
            });
        }

        const ids = [...new Set(requestedIds.map(parseNotificationId))];
        if (ids.includes(null) || ids.length === 0) {
            return sendError(res, 'All notification IDs must be positive integers', {
                statusCode: 400,
                errorCode: 'INVALID_NOTIFICATION_IDS'
            });
        }

        const placeholders = ids.map(() => '?').join(', ');
        const [result] = await db.query(
            `DELETE FROM notifications WHERE user_id = ? AND id IN (${placeholders})`,
            [req.user.id, ...ids]
        );

        return sendSuccess(res, 'Selected notifications deleted successfully', {
            deletedCount: result.affectedRows,
            ids
        });
    } catch (error) {
        console.error('Bulk delete notifications error:', error);
        return sendError(res, 'Server error while deleting notifications', {
            statusCode: 500,
            errorCode: 'NOTIFICATIONS_BULK_DELETE_FAILED'
        });
    }
};

exports.deleteAllNotifications = async (req, res) => {
    try {
        const [result] = await db.query(
            'DELETE FROM notifications WHERE user_id = ?',
            [req.user.id]
        );

        return sendSuccess(res, 'All notifications deleted successfully', {
            deletedCount: result.affectedRows
        });
    } catch (error) {
        console.error('Delete all notifications error:', error);
        return sendError(res, 'Server error while deleting notifications', {
            statusCode: 500,
            errorCode: 'NOTIFICATIONS_DELETE_ALL_FAILED'
        });
    }
};
