const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../config/database');
const { logAudit } = require('../utils/auditLogger');
const emailService = require('../utils/emailService');

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const RESET_TOKEN_HOURS = 1;

const normalizeEmail = (value = '') => String(value).trim().toLowerCase();
const isStrongPassword = value => {
    const password = String(value || '');
    return password.length >= 12 && /[a-z]/.test(password) && /[A-Z]/.test(password)
        && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
};

const normalizeLegacyGovEmail = (value = '') => {
    const normalized = normalizeEmail(value);
    const legacyGovPattern = /^([a-z0-9._%+-]+)\.gov\.ph$/;

    // Backward compatibility: map legacy format (admin.gov.ph) to current format (admin@gov.ph).
    if (!normalized.includes('@') && legacyGovPattern.test(normalized)) {
        return normalized.replace(legacyGovPattern, '$1@gov.ph');
    }

    return normalized;
};

// Login user
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const normalizedEmail = normalizeLegacyGovEmail(email);

        // Validate input
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required'
            });
        }

        // Check if user exists
        const [users] = await db.query(
            'SELECT * FROM users WHERE email = ? AND status = ?',
            [normalizedEmail, 'active']
        );

        if (users.length === 0) {
            await logAudit({
                action: 'LOGIN_FAILED',
                entityType: 'auth',
                metadata: { email, reason: 'user_not_found_or_inactive' },
                req
            });

            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        const user = users[0];

        if (!['admin', 'apprehending_officer'].includes(user.role)) {
            await logAudit({
                userId: user.id,
                action: 'LOGIN_BLOCKED_DISABLED_ROLE',
                entityType: 'users',
                entityId: user.id,
                metadata: { email: user.email, role: user.role },
                req
            });

            return res.status(403).json({
                success: false,
                message: 'This account role is no longer supported.'
            });
        }

        if (user.locked_until && new Date(user.locked_until) > new Date()) {
            await logAudit({
                userId: user.id,
                action: 'LOGIN_BLOCKED_LOCKED',
                entityType: 'users',
                entityId: user.id,
                metadata: { email: user.email, lockedUntil: user.locked_until },
                req
            });

            return res.status(423).json({
                success: false,
                message: 'Account is temporarily locked due to too many failed login attempts. Please try again later.'
            });
        }

        // Verify password
        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            const failedAttempts = (user.failed_login_attempts || 0) + 1;
            let lockedUntil = null;

            if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
                lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
            }

            try {
                await db.query(
                    'UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?',
                    [failedAttempts, lockedUntil, user.id]
                );
            } catch (updateError) {
                console.error('Lockout update skipped:', updateError.message);
            }

            await logAudit({
                userId: user.id,
                action: lockedUntil ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED',
                entityType: 'users',
                entityId: user.id,
                metadata: { failedAttempts, lockedUntil },
                req
            });

            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        try {
            await db.query(
                'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login = NOW() WHERE id = ?',
                [user.id]
            );
        } catch (resetError) {
            console.error('Lockout reset skipped:', resetError.message);
        }

        // Generate JWT token
        const token = jwt.sign(
            {
                id: user.id,
                email: user.email,
                role: user.role,
                name: user.name
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
        );

        await logAudit({
            userId: user.id,
            action: 'LOGIN_SUCCESS',
            entityType: 'users',
            entityId: user.id,
            metadata: { role: user.role },
            req
        });

        res.json({
            success: true,
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during login'
        });
    }
};

// Logout user (client-side will remove token)
exports.logout = async (req, res) => {
    try {
        // Log the logout action to audit trail (panel requirement)
        if (req.user && req.user.id) {
            await logAudit({
                userId: req.user.id,
                action: 'LOGOUT',
                entityType: 'users',
                entityId: req.user.id,
                metadata: { 
                    username: req.user.name || req.user.email,
                    role: req.user.role
                },
                ipAddress: req.ip || req.connection?.remoteAddress,
                userAgent: req.headers?.['user-agent']
            });
        }
        res.json({
            success: true,
            message: 'Logout successful'
        });
    } catch (error) {
        // Still logout even if audit logging fails
        res.json({
            success: true,
            message: 'Logout successful'
        });
    }
};

exports.requestPasswordReset = async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        const genericMessage = 'If this email belongs to an active account, password reset instructions will be sent.';
        if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

        const [users] = await db.query('SELECT id, email, status FROM users WHERE email = ? LIMIT 1', [email]);
        if (!users.length || users[0].status !== 'active') return res.json({ success: true, message: genericMessage });

        if (!process.env.SMTP_HOST || !process.env.APP_PUBLIC_URL) {
            console.error('Password reset delivery is unavailable because SMTP_HOST or APP_PUBLIC_URL is not configured.');
            return res.json({ success: true, message: genericMessage });
        }

        const user = users[0];
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
        const expiresAt = new Date(Date.now() + RESET_TOKEN_HOURS * 60 * 60 * 1000);
        await db.query('UPDATE users SET reset_token_hash=?, reset_token_expires=? WHERE id=?', [resetTokenHash, expiresAt, user.id]);

        const resetLink = `${String(process.env.APP_PUBLIC_URL).replace(/\/$/, '')}/pages/reset-password.html?token=${encodeURIComponent(resetToken)}`;
        const sent = await emailService.sendPasswordResetEmail(user.email, resetLink);
        if (!sent) {
            await db.query('UPDATE users SET reset_token_hash = NULL, reset_token_expires = NULL WHERE id = ?', [user.id]);
            return res.json({ success: true, message: genericMessage });
        }

        await logAudit({ userId: user.id, action: 'PASSWORD_RESET_REQUESTED', entityType: 'users', entityId: user.id, metadata: { expiresAt }, req });
        return res.json({ success: true, message: genericMessage });
    } catch (error) {
        console.error('Request password reset error:', error);
        return res.status(500).json({ success: false, message: 'Server error while requesting password reset' });
    }
};

exports.resetPassword = async (req, res) => {
    try {
        const { token, newPassword } = req.body;

        if (!token || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Token and new password are required'
            });
        }

        if (!isStrongPassword(newPassword)) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 12 characters and include uppercase, lowercase, number, and symbol.'
            });
        }

        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

        const [users] = await db.query(
            'SELECT id, email FROM users WHERE reset_token_hash = ? AND reset_token_expires > NOW() LIMIT 1',
            [tokenHash]
        );

        if (users.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired reset token'
            });
        }

        const user = users[0];
        const hashedPassword = await bcrypt.hash(newPassword, 12);

        const [updateResult] = await db.query(
            `UPDATE users
             SET password = ?,
                 reset_token_hash = NULL,
                 reset_token_expires = NULL,
                 failed_login_attempts = 0,
                 locked_until = NULL
             WHERE id = ? AND reset_token_hash = ? AND reset_token_expires > NOW()`,
            [hashedPassword, user.id, tokenHash]
        );
        if (updateResult.affectedRows !== 1) {
            return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
        }

        await logAudit({
            userId: user.id,
            action: 'PASSWORD_RESET_COMPLETED',
            entityType: 'users',
            entityId: user.id,
            metadata: {},
            req
        });

        res.json({
            success: true,
            message: 'Password has been reset successfully'
        });
    } catch (error) {
        console.error('Reset password error:', error);

        if (error.code === 'ER_BAD_FIELD_ERROR') {
            return res.status(400).json({
                success: false,
                message: 'Password reset is temporarily unavailable. Please restart the server so auto-migration can verify the database schema, then try again.'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error while resetting password'
        });
    }
};

// Get current user profile
exports.getProfile = async (req, res) => {
    try {
        const [users] = await db.query(
            'SELECT id, name, email, role, contact_number, plate_number, created_at FROM users WHERE id = ?',
            [req.user.id]
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
        console.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};
