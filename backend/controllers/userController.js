const bcrypt = require('bcrypt');
const db = require('../config/database');
const { logAudit } = require('../utils/auditLogger');

const isStrongPassword = value => {
    const password = String(value || '');
    return password.length >= 12 && /[a-z]/.test(password) && /[A-Z]/.test(password)
        && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
};
const isValidEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
const validProfileFields = ({ name, email, contactNumber }) =>
    Boolean(name) && name.length <= 100 && isValidEmail(email) && email.length <= 100 && String(contactNumber || '').length <= 20;

// Get all users (Admin only)
exports.getAllUsers = async (req, res) => {
    try {
        const [users] = await db.query(
            `SELECT id, name, email, role, contact_number, status, last_login, locked_until, created_at
             FROM users
             WHERE role IN ('admin', 'apprehending_officer')
             ORDER BY created_at DESC`
        );

        res.json({
            success: true,
            users
        });

    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// Get user by ID
exports.getUserById = async (req, res) => {
    try {
        const { id } = req.params;

        const [users] = await db.query(
            'SELECT id, name, email, role, contact_number, status, created_at FROM users WHERE id = ?',
            [id]
        );

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            user: users[0]
        });

    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// Create new user (Admin only)
exports.createUser = async (req, res) => {
    try {
        const { name, email, password, role, contact_number } = req.body;
        const normalizedName = String(name || '').trim();
        const normalizedEmail = String(email || '').trim().toLowerCase();
        const normalizedContact = String(contact_number || '').trim();

        // Validate input
        if (!normalizedName || !normalizedEmail || !password || !role) {
            return res.status(400).json({
                success: false,
                message: 'Name, email, password, and role are required'
            });
        }

        if (!validProfileFields({ name: normalizedName, email: normalizedEmail, contactNumber: normalizedContact })) {
            return res.status(400).json({ success: false, message: 'Name, email, or contact number is invalid or too long.' });
        }

        if (!isStrongPassword(password)) {
            return res.status(400).json({ success: false, message: 'Password must be at least 12 characters and include uppercase, lowercase, number, and symbol.' });
        }

        const ALLOWED_ROLES = ['admin', 'apprehending_officer'];
        if (!ALLOWED_ROLES.includes(role)) {
            return res.status(400).json({
                success: false,
                message: `Invalid role. Allowed roles: ${ALLOWED_ROLES.join(', ')}`
            });
        }

        // Check if email already exists
        const [existingUsers] = await db.query(
            'SELECT id FROM users WHERE email = ?',
            [normalizedEmail]
        );

        if (existingUsers.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'Email already exists'
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert new user
        const [result] = await db.query(
            'INSERT INTO users (name, email, password, role, contact_number) VALUES (?, ?, ?, ?, ?)',
            [normalizedName, normalizedEmail, hashedPassword, role, normalizedContact || null]
        );

        await logAudit({
            userId: req.user.id,
            action: 'USER_CREATED',
            entityType: 'users',
            entityId: result.insertId,
            metadata: { name: normalizedName, email: normalizedEmail, role },
            req
        });

        res.status(201).json({
            success: true,
            message: 'User created successfully',
            userId: result.insertId
        });

    } catch (error) {
        console.error('Create user error:', error);
        if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'Email already exists' });
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// Update user

exports.updateUser = async (req, res) => {
    try {
        const id=Number(req.params.id);
        const [rows]=await db.query('SELECT id,name,email,role,contact_number,status FROM users WHERE id=?',[id]);
        if(!rows.length)return res.status(404).json({success:false,message:'User not found'});
        const current=rows[0];
        const next={
            name:req.body.name!==undefined?String(req.body.name).trim():current.name,
            email:req.body.email!==undefined?String(req.body.email).trim().toLowerCase():current.email,
            role:req.body.role||current.role,
            contact_number:req.body.contact_number!==undefined?(req.body.contact_number||null):current.contact_number,
            status:req.body.status||current.status
        };
        next.contact_number = String(next.contact_number || '').trim() || null;
        if(!validProfileFields({ name: next.name, email: next.email, contactNumber: next.contact_number }))return res.status(400).json({success:false,message:'Name, email, or contact number is invalid or too long'});
        if(!['admin','apprehending_officer'].includes(next.role))return res.status(400).json({success:false,message:'Invalid role'});
        if(!['active','inactive'].includes(next.status))return res.status(400).json({success:false,message:'Invalid status'});
        if(current.role==='admin'&&(next.role!=='admin'||next.status!=='active')){
            const [[count]]=await db.query("SELECT COUNT(*) total FROM users WHERE role='admin' AND status='active' AND id<>?",[id]);
            if(Number(count.total)<1)return res.status(409).json({success:false,message:'At least one active administrator must remain.'});
        }
        await db.query('UPDATE users SET name=?,email=?,role=?,contact_number=?,status=? WHERE id=?',[next.name,next.email,next.role,next.contact_number,next.status,id]);
        await logAudit({userId:req.user.id,action:'USER_UPDATED',entityType:'users',entityId:id,metadata:{role:next.role,status:next.status},req});
        return res.json({success:true,message:'User updated successfully'});
    } catch(error){
        console.error('Update user error:',error);
        if(error.code==='ER_DUP_ENTRY')return res.status(409).json({success:false,message:'Email already exists'});
        return res.status(500).json({success:false,message:'Server error'});
    }
};

// Unlock a user account that was auto-locked after repeated failed logins
exports.unlockUser = async (req, res) => {
    try {
        const { id } = req.params;

        const [users] = await db.query('SELECT id FROM users WHERE id = ?', [id]);
        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        await db.query(
            'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
            [id]
        );

        await logAudit({
            userId: req.user.id,
            action: 'USER_UNLOCKED',
            entityType: 'users',
            entityId: parseInt(id, 10),
            metadata: {},
            req
        });

        res.json({
            success: true,
            message: 'Account unlocked successfully'
        });
    } catch (error) {
        console.error('Unlock user error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// Delete user

exports.deleteUser = async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }
    if (id === Number(req.user.id)) {
        return res.status(400).json({ success: false, message: 'You cannot delete your own account while logged in.' });
    }

    const connection = await db.getConnection();
    let deletedUser = null;

    try {
        await connection.beginTransaction();

        const [rows] = await connection.query(
            'SELECT id, name, role, status, email FROM users WHERE id = ? FOR UPDATE',
            [id]
        );
        if (!rows.length) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        deletedUser = rows[0];

        if (deletedUser.role === 'admin' && deletedUser.status === 'active') {
            const [activeAdmins] = await connection.query(
                "SELECT id FROM users WHERE role = 'admin' AND status = 'active' FOR UPDATE"
            );
            if (activeAdmins.length < 2) {
                await connection.rollback();
                return res.status(409).json({ success: false, message: 'At least one active administrator must remain.' });
            }
        }

        // Enforcement and financial records must retain their original officer/admin.
        // Accounts with those references can be deactivated, but not hard-deleted.
        const dependencyGroups = [
            { table: 'tickets', columns: ['user_id'], label: 'ticket' },
            { table: 'ticket_status_history', columns: ['changed_by', 'approver_id'], label: 'ticket status change' },
            { table: 'payments', columns: ['recorded_by', 'cashier_user_id'], label: 'payment' },
            { table: 'disputes', columns: ['submitted_by', 'resolved_by'], label: 'dispute' },
            { table: 'evidence', columns: ['uploaded_by'], label: 'evidence record' }
        ];
        const [availableColumns] = await connection.query(
            `SELECT TABLE_NAME, COLUMN_NAME
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME IN ('tickets', 'ticket_status_history', 'payments', 'disputes', 'evidence')`
        );
        const columnKeys = new Set(availableColumns.map(column =>
            `${column.TABLE_NAME || column.table_name}.${column.COLUMN_NAME || column.column_name}`
        ));
        const referenceLabels = [];

        for (const group of dependencyGroups) {
            const columns = group.columns.filter(column => columnKeys.has(`${group.table}.${column}`));
            if (!columns.length) continue;
            // Identifiers come only from the fixed allowlist above; values remain parameterized.
            const where = columns.map(column => `\`${column}\` = ?`).join(' OR ');
            const [[referenceCount]] = await connection.query(
                `SELECT COUNT(*) AS total FROM \`${group.table}\` WHERE ${where}`,
                columns.map(() => id)
            );
            const total = Number(referenceCount.total);
            if (total > 0) {
                referenceLabels.push(`${total} ${group.label}${total === 1 ? '' : 's'}`);
            }
        }

        if (referenceLabels.length) {
            await connection.rollback();
            return res.status(409).json({
                success: false,
                message: `This account cannot be permanently deleted because it is linked to ${referenceLabels.join(', ')}. Deactivate it instead to preserve historical records.`
            });
        }

        const [result] = await connection.query('DELETE FROM users WHERE id = ?', [id]);
        if (result.affectedRows !== 1) {
            throw new Error('User deletion did not affect exactly one account.');
        }
        await connection.commit();

        await logAudit({
            userId: req.user.id,
            action: 'USER_DELETED',
            entityType: 'users',
            entityId: id,
            metadata: { email: deletedUser.email, name: deletedUser.name, role: deletedUser.role },
            req
        });
        return res.json({ success: true, message: 'User account permanently deleted.' });
    } catch (error) {
        try { await connection.rollback(); } catch (rollbackError) { /* connection may already be closed */ }
        if (error.code === 'ER_ROW_IS_REFERENCED_2' || error.code === 'ER_ROW_IS_REFERENCED') {
            return res.status(409).json({
                success: false,
                message: 'This account is linked to historical records and cannot be permanently deleted. Deactivate it instead.'
            });
        }
        console.error('Delete user error:', error);
        return res.status(500).json({ success: false, message: 'Server error while deleting user' });
    } finally {
        connection.release();
    }
};

// Change password
exports.changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = req.user.id;

        // Validate input
        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Current password and new password are required'
            });
        }

        if (!isStrongPassword(newPassword)) {
            return res.status(400).json({
                success: false,
                message: 'New password must be at least 12 characters and include uppercase, lowercase, number, and symbol.'
            });
        }
        if (currentPassword === newPassword) {
            return res.status(400).json({ success: false, message: 'New password must be different from the current password.' });
        }

        // Get user
        const [users] = await db.query('SELECT password FROM users WHERE id = ?', [userId]);

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Verify current password
        const isPasswordValid = await bcrypt.compare(currentPassword, users[0].password);

        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: 'Current password is incorrect'
            });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password
        await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);

        await logAudit({
            userId,
            action: 'PASSWORD_CHANGED',
            entityType: 'users',
            entityId: userId,
            metadata: {},
            req
        });

        res.json({
            success: true,
            message: 'Password changed successfully'
        });

    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// Update current user profile (name, email, contact)
exports.updateMyProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const { name, email, contact_number } = req.body;

        const normalizedName = String(name || '').trim();
        const normalizedEmail = String(email || '').trim().toLowerCase();
        const normalizedContact = String(contact_number || '').trim();

        if (!validProfileFields({ name: normalizedName, email: normalizedEmail, contactNumber: normalizedContact })) {
            return res.status(400).json({
                success: false,
                message: 'A valid name and email are required'
            });
        }

        const [existingUser] = await db.query(
            'SELECT id FROM users WHERE id = ? LIMIT 1',
            [userId]
        );

        if (existingUser.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const [duplicateUsers] = await db.query(
            'SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1',
            [normalizedEmail, userId]
        );

        if (duplicateUsers.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'Email already exists'
            });
        }

        await db.query(
            `UPDATE users
             SET name = ?,
                 email = ?,
                 contact_number = ?
             WHERE id = ?`,
            [normalizedName, normalizedEmail, normalizedContact || null, userId]
        );

        const [updatedUser] = await db.query(
            'SELECT id, name, email, role, contact_number, plate_number, created_at FROM users WHERE id = ? LIMIT 1',
            [userId]
        );

        await logAudit({
            userId,
            action: 'PROFILE_UPDATED',
            entityType: 'users',
            entityId: userId,
            metadata: { name: normalizedName, email: normalizedEmail },
            req
        });

        res.json({
            success: true,
            message: 'Profile updated successfully',
            user: updatedUser[0]
        });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

exports.getAuditLogs = async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);

        const [logs] = await db.query(
            `SELECT a.id, a.user_id, a.action, a.entity_type, a.entity_id, a.metadata, a.ip_address, a.user_agent, a.created_at,
                    u.name AS actor_name, u.email AS actor_email
             FROM audit_logs a
             LEFT JOIN users u ON a.user_id = u.id
             ORDER BY a.created_at DESC
             LIMIT ?`,
            [limit]
        );

        res.json({
            success: true,
            logs
        });
    } catch (error) {
        console.error('Get audit logs error:', error);

        if (error.code === 'ER_NO_SUCH_TABLE') {
            return res.status(400).json({
                success: false,
                message: 'Audit log table is out of date. Restart the server so auto-migration can update it.'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};


exports.clearTestLogs = async (req, res) => {
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
        return res.status(403).json({ success: false, message: 'Audit log deletion is disabled outside development.' });
    }
    try {
        const [result]=await db.query("DELETE FROM audit_logs WHERE action LIKE 'TEST_%'");
        await logAudit({userId:req.user.id,action:'TEST_AUDIT_LOGS_CLEARED',entityType:'audit_logs',metadata:{deleted:result.affectedRows},req});
        return res.json({success:true,message:`${result.affectedRows} test audit log(s) removed.`,deletedRows:result.affectedRows});
    } catch(error){return res.status(500).json({success:false,message:'Failed to clear test audit logs'});}
};
