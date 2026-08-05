const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const { verifyToken, isAdmin } = require('../middleware/authMiddleware');

// All routes require authentication and admin role
router.use(verifyToken);
router.use(isAdmin);

// Get all system settings
router.get('/', settingsController.getSystemSettings);

// Get specific setting value
router.get('/:key', settingsController.getSettingValue);

// Update settings (single or multiple)
router.put('/', settingsController.updateSystemSettings);

// Bulk update settings
router.put('/bulk/update', settingsController.updateBulkSettings);

module.exports = router;
