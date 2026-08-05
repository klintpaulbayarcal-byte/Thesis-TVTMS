const express = require('express');
const router = express.Router();
const publicController = require('../controllers/publicController');

router.get('/stats', publicController.publicStats);
router.get('/violations', publicController.publicViolations);
router.get('/ticket-lookup', publicController.publicTicketLookup);
router.get('/vehicle-lookup', publicController.vehicleLookup);
router.get('/plate-summary', publicController.plateSummary);
router.post('/dispute', publicController.publicFileDispute);
router.post('/contact', publicController.publicContact);

module.exports = router;
