const express = require('express');
const router = express.Router();
const vehicleController = require('../controllers/vehicleController');
const { verifyToken, isAdmin, isOfficerOrAdmin } = require('../middleware/authMiddleware');

// All routes require authentication
router.use(verifyToken);

// Authenticated vehicle lookup for authorized personnel
router.get('/lookup', vehicleController.lookupByPlate);
router.get('/stats', vehicleController.getVehicleStats);
router.get('/search', isOfficerOrAdmin, vehicleController.searchVehicles); // Panel: repeat offender search
router.get('/:id', vehicleController.getVehicleById);

// Admin-only routes
router.get('/', isAdmin, vehicleController.getAllVehicles);

module.exports = router;
