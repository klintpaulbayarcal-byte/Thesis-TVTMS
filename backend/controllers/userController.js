const bcrypt = require('bcrypt');
const { supabase, run, rpc, allRows } = require('../config/supabase');
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
        const users = await allRows(() => supabase.from('users').select('id,name,email,role,contact_number,status,last_login,locked_until,created_at').in('role', ['admin', 'apprehending_officer']).order('created_at', { ascending: false }).order('id'));

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

        const users = await run(supabase.from('users').select('id,name,email,role,contact_number,status,created_at').eq('id', id));

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
        const existingUsers = await run(supabase.from('users').select('id').eq('email', normalizedEmail));

        if (existingUsers.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'Email already exists'
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert new user
        const result = await run(supabase.from('users').insert({ name: normalizedName, email: normalizedEmail, password: hashedPassword, role, contact_number: normalizedContact || null }).select('id').single());

        await logAudit({
            userId: req.user.id,
            action: 'USER_CREATED',
            entityType: 'users',
            entityId: result.id,
            metadata: { name: normalizedName, email: normalizedEmail, role },
            req
        });

        res.status(201).json({
            success: true,
            message: 'User created successfully',
            userId: result.id
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
        const rows=await run(supabase.from('users').select('id,name,email,role,contact_number,status').eq('id', id));
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
        const outcome = await rpc('tvtms_account_update', { p_id: id, p_name: next.name, p_email: next.email, p_role: next.role, p_contact: next.contact_number, p_status: next.status });
        if (outcome.error) return res.status(outcome.status).json({ success: false, message: outcome.error });
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

        const users = await run(supabase.from('users').update({ failed_login_attempts: 0, locked_until: null }).eq('id', id).select('id'));
        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

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

    try {
        const outcome = await rpc('tvtms_account_delete', { p_id: id });
        if (outcome.error) return res.status(outcome.status).json({ success: false, message: outcome.error });
        const deletedUser = outcome.user;
        await logAudit({ userId: req.user.id, action: 'USER_DELETED', entityType: 'users', entityId: id,
            metadata: { email: deletedUser.email, name: deletedUser.name, role: deletedUser.role }, req });
        return res.json({ success: true, message: 'User account permanently deleted.' });
    } catch (error) {
        if (['ER_ROW_IS_REFERENCED_2', 'ER_ROW_IS_REFERENCED'].includes(error.code)) {
            return res.status(409).json({ success: false, message: 'This account is linked to historical records and cannot be permanently deleted. Deactivate it instead.' });
        }
        console.error('Delete user error:', error);
        return res.status(500).json({ success: false, message: 'Server error while deleting user' });
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
        const users = await run(supabase.from('users').select('password').eq('id', userId));

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
        const changed = await run(supabase.from('users').update({ password: hashedPassword }).eq('id', userId).eq('password', users[0].password).select('id'));
        if (!changed.length) return res.status(409).json({ success: false, message: 'Password changed concurrently. Please retry.' });

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

        const existingUser = await run(supabase.from('users').select('id').eq('id', userId).limit(1));

        if (existingUser.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const duplicateUsers = await run(supabase.from('users').select('id').eq('email', normalizedEmail).neq('id', userId).limit(1));

        if (duplicateUsers.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'Email already exists'
            });
        }

        const updatedUser = await run(supabase.from('users').update({ name: normalizedName, email: normalizedEmail, contact_number: normalizedContact || null }).eq('id', userId).select('id,name,email,role,contact_number,plate_number,created_at'));
        if (!updatedUser.length) return res.status(404).json({ success: false, message: 'User not found' });

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
        if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'Email already exists' });
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

exports.getAuditLogs = async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);

        const logs = await run(supabase.from('audit_logs').select('id,user_id,action,entity_type,entity_id,metadata,ip_address,user_agent,created_at,users(name,email)').order('created_at', { ascending: false }).order('id').limit(limit));

        res.json({
            success: true,
            logs: logs.map(({ users, ...log }) => ({ ...log, actor_name: users?.name || null, actor_email: users?.email || null }))
        });
    } catch (error) {
        console.error('Get audit logs error:', error);

        if (error.code === 'ER_NO_SUCH_TABLE') {
            return res.status(400).json({
                success: false,
                message: 'Audit log table is unavailable. Please contact the administrator.'
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
        const result=await rpc('tvtms_account_clear_test_logs', {});
        await logAudit({userId:req.user.id,action:'TEST_AUDIT_LOGS_CLEARED',entityType:'audit_logs',metadata:{deleted:result},req});
        return res.json({success:true,message:`${result} test audit log(s) removed.`,deletedRows:result});
    } catch(error){return res.status(500).json({success:false,message:'Failed to clear test audit logs'});}
};
