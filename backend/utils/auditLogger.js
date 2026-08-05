/**
 * auditLogger.js
 * Centralized audit trail for all sensitive actions in the LGU system.
 */

const db = require('../config/database');

/**
 * Log an audit event.
 * All parameters are optional except `action` — never crash the main flow.
 */
exports.logAudit = async ({
    userId = null,
    action,
    entityType = null,
    entityId = null,
    metadata = {},
    req = null
}) => {
    try {
        const ipAddress = req
            ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null)
            : null;
        const userAgent = req ? (req.headers['user-agent'] || null) : null;

        await db.query(
            `INSERT INTO audit_logs
             (user_id, action, entity_type, entity_id, metadata, ip_address, user_agent)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                userId || null,
                action,
                entityType || null,
                entityId || null,
                metadata ? JSON.stringify(metadata) : null,
                ipAddress,
                userAgent
            ]
        );
    } catch (error) {
        // Audit logging must never break the main request flow.
        if (error.code === 'ER_NO_SUCH_TABLE') {
            // Table not yet created — silently skip.
            return;
        }
        console.error('[AuditLogger] Failed to write audit log:', error.message);
    }
};
