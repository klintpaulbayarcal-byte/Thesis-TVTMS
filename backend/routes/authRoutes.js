const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken } = require('../middleware/authMiddleware');
const { authLimiter } = require('../middleware/securityMiddleware');

router.post('/login', authLimiter, authController.login);
router.post('/request-password-reset', authLimiter, authController.requestPasswordReset);
router.post('/reset-password', authLimiter, authController.resetPassword);
router.post('/logout', verifyToken, authController.logout);
router.get('/profile', verifyToken, authController.getProfile);

module.exports = router;
