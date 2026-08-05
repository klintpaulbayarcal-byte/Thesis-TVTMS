const express = require('express');
const router = express.Router();
const evidenceController = require('../controllers/evidenceController');
const { verifyToken, authorizeRoles } = require('../middleware/authMiddleware');

router.use(verifyToken);

router.get('/ticket/:ticketId', authorizeRoles('admin', 'apprehending_officer'), evidenceController.getTicketEvidence);
router.get('/:id/file', authorizeRoles('admin', 'apprehending_officer'), evidenceController.getEvidenceFile);
router.post(
    '/ticket/:ticketId',
    authorizeRoles('admin', 'apprehending_officer'),
    evidenceController.uploadMiddleware,
    evidenceController.uploadEvidence
);

module.exports = router;
