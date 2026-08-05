const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { verifyToken, authorizeRoles } = require('../middleware/authMiddleware');

router.use(verifyToken);

router.get('/', authorizeRoles('admin', 'apprehending_officer'), notificationController.getMyNotifications);
router.put('/:id/read', authorizeRoles('admin', 'apprehending_officer'), notificationController.markNotificationAsRead);
router.delete('/bulk', authorizeRoles('admin', 'apprehending_officer'), notificationController.deleteNotificationsBulk);
router.delete('/', authorizeRoles('admin', 'apprehending_officer'), notificationController.deleteAllNotifications);
router.delete('/:id', authorizeRoles('admin', 'apprehending_officer'), notificationController.deleteNotification);

module.exports = router;
