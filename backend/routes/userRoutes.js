const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { verifyToken, isAdmin } = require('../middleware/authMiddleware');

// All routes require authentication
router.use(verifyToken);

// Current authenticated user routes
router.put('/me', userController.updateMyProfile);
router.post('/change-password', userController.changePassword);

// Admin only routes
router.get('/', isAdmin, userController.getAllUsers);
router.get('/audit-logs', isAdmin, userController.getAuditLogs);
router.delete('/audit-logs/clear', isAdmin, userController.clearTestLogs);
router.post('/', isAdmin, userController.createUser);
router.get('/:id', isAdmin, userController.getUserById);
router.put('/:id', isAdmin, userController.updateUser);
router.post('/:id/unlock', isAdmin, userController.unlockUser);
router.delete('/:id', isAdmin, userController.deleteUser);

module.exports = router;
