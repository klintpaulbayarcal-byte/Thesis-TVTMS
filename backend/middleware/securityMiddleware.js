const rateLimit = require('express-rate-limit');

const buildLimiter = ({ windowMs, max, message, errorCode }) => rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message, errorCode }
});

const authLimiter = buildLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'Too many authentication attempts. Please try again later.',
    errorCode: 'RATE_LIMIT_AUTH'
});

const apiLimiter = buildLimiter({
    windowMs: 5 * 60 * 1000,
    max: 300,
    message: 'Too many requests. Please slow down and try again.',
    errorCode: 'RATE_LIMIT_API'
});

const publicLookupLimiter = buildLimiter({
    windowMs: 10 * 60 * 1000,
    max: 60,
    message: 'Too many public lookup attempts. Please try again later.',
    errorCode: 'RATE_LIMIT_LOOKUP'
});

const publicWriteLimiter = buildLimiter({
    windowMs: 30 * 60 * 1000,
    max: 8,
    message: 'Too many submissions. Please try again later.',
    errorCode: 'RATE_LIMIT_PUBLIC_WRITE'
});

module.exports = { authLimiter, apiLimiter, publicLookupLimiter, publicWriteLimiter };
