const { supabase, run } = require('../config/supabase');
const { sendSuccess, sendError } = require('../utils/apiResponse');

const countResult = async query => {
    const result = await query;
    await run(result);
    return Number(result.count || 0);
};

exports.getMyNotifications = async (req, res) => {
    try {
        const { unreadOnly, limit = 50 } = req.query;
        const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

        let query = supabase.from('notifications').select('*').eq('user_id', req.user.id);
        if (String(unreadOnly).toLowerCase() === 'true') query = query.eq('is_read', 0);
        const [items, totalCount, unreadCount] = await Promise.all([
            run(query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(safeLimit)),
            countResult(supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', req.user.id)),
            countResult(supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', req.user.id).eq('is_read', 0))
        ]);

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

        const affectedRows = await countResult(supabase.from('notifications')
            .update({ is_read: 1, read_at: new Date().toISOString() }, { count: 'exact' })
            .eq('id', id).eq('user_id', req.user.id));

        if (affectedRows === 0) {
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

        const affectedRows = await countResult(supabase.from('notifications').delete({ count: 'exact' })
            .eq('id', id).eq('user_id', req.user.id));

        if (affectedRows === 0) {
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

        const affectedRows = await countResult(supabase.from('notifications').delete({ count: 'exact' })
            .eq('user_id', req.user.id).in('id', ids));

        return sendSuccess(res, 'Selected notifications deleted successfully', {
            deletedCount: affectedRows,
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
        const affectedRows = await countResult(supabase.from('notifications').delete({ count: 'exact' })
            .eq('user_id', req.user.id));

        return sendSuccess(res, 'All notifications deleted successfully', {
            deletedCount: affectedRows
        });
    } catch (error) {
        console.error('Delete all notifications error:', error);
        return sendError(res, 'Server error while deleting notifications', {
            statusCode: 500,
            errorCode: 'NOTIFICATIONS_DELETE_ALL_FAILED'
        });
    }
};
