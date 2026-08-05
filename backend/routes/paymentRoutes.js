const express=require('express');
const router=express.Router();
const paymentController=require('../controllers/paymentController');
const {verifyToken,authorizeRoles}=require('../middleware/authMiddleware');
router.use(verifyToken);
router.post('/',authorizeRoles('admin'),paymentController.recordPayment);
router.get('/ticket/:ticketId',authorizeRoles('admin','apprehending_officer'),paymentController.getTicketPayments);
module.exports=router;
