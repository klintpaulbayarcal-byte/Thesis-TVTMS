const jwt = require('jsonwebtoken');
const db = require('../config/database');

const unauthorized = (res, message) => {
    return res.status(403).json({
        success: false,
        message
    });
};

// Middleware to verify JWT token
const verifyToken = async (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Access denied. No token provided.'
        });
    }

    let decoded;

    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: 'Invalid or expired token.'
        });
    }

    try {
        const [users] = await db.query(
            'SELECT id, name, email, role, status, plate_number FROM users WHERE id = ? LIMIT 1',
            [decoded.id]
        );

        if (users.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Invalid session. User not found.'
            });
        }

        if (users[0].status && users[0].status !== 'active') {
            return res.status(401).json({
                success: false,
                message: 'Account is inactive. Please contact administrator.'
            });
        }

        if (!['admin', 'apprehending_officer'].includes(users[0].role)) {
            return res.status(403).json({
                success: false,
                message: 'This account role is no longer supported.'
            });
        }

        req.user = {
            ...decoded,
            id: users[0].id,
            role: users[0].role,
            email: users[0].email,
            name: users[0].name,
            plate_number: users[0].plate_number || decoded.plate_number
        }; // Add trusted user info from DB

        next();
    } catch (error) {
        console.error('Token verification failed due to DB lookup error:', error.message);
        return res.status(503).json({
            success: false,
            message: 'Authentication service temporarily unavailable. Please retry.'
        });
    }
};

// Middleware to check if user is admin
const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return unauthorized(res, 'Access denied. Admin privileges required.');
    }
    next();
};

// Middleware to check if user is Apprehending Officer or Admin
const isOfficerOrAdmin = (req, res, next) => {
    if (req.user.role !== 'apprehending_officer' && req.user.role !== 'admin') {
        return unauthorized(res, 'Access denied. Apprehending Officer or Admin privileges required.');
    }
    next();
};

const authorizeRoles = (...roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return unauthorized(res, `Access denied. Allowed roles: ${roles.join(', ')}`);
        }

        next();
    };
};

module.exports = {
    verifyToken,
    isAdmin,
    isOfficerOrAdmin,
    authorizeRoles
};
