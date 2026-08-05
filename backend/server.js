const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const crypto = require('crypto');
require('dotenv').config();

const db = require('./config/database');
const autoMigrate = require('./utils/autoMigrate');
const { apiLimiter, publicLookupLimiter, publicWriteLimiter } = require('./middleware/securityMiddleware');

const app = express();
const PORT = Number(process.env.PORT || 5000);
const isProduction = process.env.NODE_ENV === 'production';

const validateEnvironment = () => {
    const errors = [];
    const jwtSecret = String(process.env.JWT_SECRET || '');
    if (jwtSecret.length < 32 || /your-secret|change-me|secret-key/i.test(jwtSecret)) {
        errors.push('JWT_SECRET must be a strong, unique value with at least 32 characters.');
    }
    for (const key of ['DB_HOST', 'DB_USER', 'DB_NAME']) {
        if (isProduction && !process.env[key]) errors.push(`${key} is required in production.`);
    }
    if (isProduction && !String(process.env.ALLOWED_ORIGINS || '').trim()) {
        errors.push('ALLOWED_ORIGINS is required in production.');
    }
    if (errors.length) throw new Error(`Environment validation failed:\n- ${errors.join('\n- ')}`);
};

app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

app.use((req, res, next) => {
    res.locals.requestId = crypto.randomUUID();
    res.setHeader('X-Request-ID', res.locals.requestId);
    next();
});

app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'no-referrer' }
}));

const allowedOrigins = String(process.env.ALLOWED_ORIGINS || '')
    .split(',').map(v => v.trim()).filter(Boolean);
app.use(cors({
    origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (!isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('Origin is not allowed by CORS.'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use('/api', apiLimiter);
app.use('/api/public/ticket-lookup', publicLookupLimiter);
app.use('/api/public/vehicle-lookup', publicLookupLimiter);
app.use('/api/public/plate-summary', publicLookupLimiter);
app.use('/api/public/dispute', publicWriteLimiter);
app.use('/api/public/contact', publicWriteLimiter);

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const violationRoutes = require('./routes/violationRoutes');
const ticketRoutes = require('./routes/ticketRoutes');
const reportRoutes = require('./routes/reportRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const disputeRoutes = require('./routes/disputeRoutes');
const evidenceRoutes = require('./routes/evidenceRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const vehicleRoutes = require('./routes/vehicleRoutes');
const publicRoutes = require('./routes/publicRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/system/settings', settingsRoutes);
app.use('/api/violations', violationRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/disputes', disputeRoutes);
app.use('/api/evidence', evidenceRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/public', publicRoutes);

app.get('/api/health', async (req, res) => {
    try {
        await db.checkConnection();
        res.json({ success: true, status: 'healthy', database: 'connected', timestamp: new Date().toISOString() });
    } catch (error) {
        res.status(503).json({ success: false, status: 'unhealthy', database: 'disconnected', timestamp: new Date().toISOString() });
    }
});

app.get('/', (req, res) => res.json({
    success: true,
    message: 'Municipal Traffic Violation Ticketing and Management System API',
    version: '1.1.0',
    requestId: res.locals.requestId,
    timestamp: new Date().toISOString()
}));

app.use((req, res) => res.status(404).json({
    success: false, message: 'API endpoint not found', errorCode: 'NOT_FOUND',
    requestId: res.locals.requestId, timestamp: new Date().toISOString()
}));

app.use((err, req, res, next) => {
    console.error(`[${res.locals.requestId}]`, err);
    const corsError = String(err.message || '').includes('CORS');
    res.status(corsError ? 403 : 500).json({
        success: false,
        message: corsError ? 'Request origin is not allowed.' : 'Internal server error',
        errorCode: corsError ? 'CORS_DENIED' : 'INTERNAL_SERVER_ERROR',
        requestId: res.locals.requestId,
        timestamp: new Date().toISOString()
    });
});

const start = async () => {
    validateEnvironment();
    await db.checkConnection();
    await autoMigrate();
    app.listen(PORT, () => console.log(`API listening on port ${PORT}`));
};

if (require.main === module) {
    start().catch(error => {
        console.error('Server startup aborted:', error.message);
        process.exit(1);
    });
}

module.exports = app;
