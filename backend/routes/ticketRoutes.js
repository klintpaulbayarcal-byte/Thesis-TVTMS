const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticketController');
const { verifyToken, isOfficerOrAdmin, authorizeRoles, isAdmin } = require('../middleware/authMiddleware');

// All routes require authentication
router.use(verifyToken);

router.get('/', authorizeRoles('admin', 'apprehending_officer'), ticketController.getAllTickets);
router.get('/stats', authorizeRoles('admin', 'apprehending_officer'), ticketController.getDashboardStats);
router.get('/search', authorizeRoles('admin', 'apprehending_officer'), ticketController.searchTickets);
router.get('/:id', authorizeRoles('admin', 'apprehending_officer'), ticketController.getTicketById);
router.post('/', isOfficerOrAdmin, ticketController.createTicket);
router.put('/:id/details', authorizeRoles('admin', 'apprehending_officer'), ticketController.updateTicketDetails);
router.put('/:id', authorizeRoles('admin', 'apprehending_officer'), ticketController.updateTicketStatus);
router.delete('/:id/permanent', isAdmin, ticketController.permanentlyDeleteTicket);
router.delete('/:id', isAdmin, ticketController.deleteTicket);
// NOTE: removed duplicate DELETE /delete/:id route

module.exports = router;
