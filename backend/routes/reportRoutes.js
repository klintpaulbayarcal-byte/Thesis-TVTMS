const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { verifyToken, isAdmin } = require('../middleware/authMiddleware');

// All routes require authentication and admin privileges
router.use(verifyToken);
router.use(isAdmin);

router.get('/daily', reportController.getDailyReport);
router.get('/monthly', reportController.getMonthlyReport);
router.get('/yearly', reportController.getYearlyReport);
router.get('/custom', reportController.getCustomReport);
router.get('/export/pdf', reportController.exportReportPdf);
router.get('/violations', reportController.getViolationStats);
router.get('/officers', reportController.getOfficerPerformance);
router.get('/collections', reportController.getCollectionsSummary);
router.get('/hotspots', reportController.getViolationHotspots);
router.get('/productivity', reportController.getOfficerPerformance);
// New LGU-specific reports
router.get('/officer-performance', reportController.officerPerformance);
router.get('/aging', reportController.agingReport);
router.get('/barangay', reportController.barangayReport);

// Analytics Dashboard Endpoints
router.get('/analytics/collections', reportController.getCollectionsChart);
router.get('/analytics/payment-status', reportController.getPaymentStatus);
router.get('/analytics/tickets-summary', reportController.getTicketsSummary);
router.get('/analytics/dispute-rate', reportController.getDisputeRate);
router.get('/analytics/monthly-revenue', reportController.getMonthlyRevenue);

module.exports = router;
