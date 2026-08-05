const express = require('express');
const router = express.Router();
const violationController = require('../controllers/violationController');
const { verifyToken, isAdmin } = require('../middleware/authMiddleware');

// All routes require authentication
router.use(verifyToken);

// Public (authenticated) routes
router.get('/', violationController.getAllViolations);
router.get('/active', violationController.getActiveViolations);
router.get('/:id/penalty-preview', violationController.getPenaltyPreview);
router.get('/:id', violationController.getViolationById);

// Admin only routes
router.post('/', isAdmin, violationController.createViolation);
router.put('/:id', isAdmin, violationController.updateViolation);
router.delete('/:id', isAdmin, violationController.deleteViolation);

module.exports = router;
