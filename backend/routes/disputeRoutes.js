const express=require('express');
const router=express.Router();
const disputeController=require('../controllers/disputeController');
const {verifyToken,authorizeRoles}=require('../middleware/authMiddleware');
router.use(verifyToken);
router.get('/',authorizeRoles('admin','apprehending_officer'),disputeController.getDisputes);
router.post('/',authorizeRoles('admin','apprehending_officer'),disputeController.createDispute);
router.put('/:id/resolve',authorizeRoles('admin'),disputeController.resolveDispute);
module.exports=router;
