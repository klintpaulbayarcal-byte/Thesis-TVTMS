const db = require('../config/database');
const { sendSuccess, sendError } = require('../utils/apiResponse');
const { logAudit } = require('../utils/auditLogger');
const emailService = require('../utils/emailService');

const todayInManila = () => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date()).reduce((result, part) => {
        if (part.type !== 'literal') result[part.type] = part.value;
        return result;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
};

const isValidDateString = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
    const [year, month, day] = String(value).split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

exports.recordPayment = async (req, res) => {
    const connection = await db.getConnection();
    let committed = false;
    try {
        const { ticket_id, or_number, official_receipt_number, amount_paid, payment_date, payment_method = 'cash', notes } = req.body;
        const ticketId = Number(ticket_id);
        const receiptNumber = String(official_receipt_number || or_number || '').trim().toUpperCase();
        const amount = Number(amount_paid);
        const method = String(payment_method || 'cash').trim().toLowerCase();
        const normalizedNotes = String(notes || '').trim();
        if (!Number.isInteger(ticketId) || ticketId <= 0 || !receiptNumber || receiptNumber.length > 50 ||
            !Number.isFinite(amount) || amount <= 0 || amount > 10000000 || Math.abs(Math.round(amount * 100) - amount * 100) > 1e-8) {
            return sendError(res, 'Valid ticket, official receipt number, and a positive amount with at most two decimal places are required', {
                statusCode: 400, errorCode: 'VALIDATION_ERROR'
            });
        }
        if (normalizedNotes.length > 2000) {
            return sendError(res, 'Payment notes exceed the allowed length', { statusCode: 400, errorCode: 'VALIDATION_ERROR' });
        }
        const validMethods = ['cash', 'gcash', 'maya', 'bank_transfer', 'other'];
        if (!validMethods.includes(method)) return sendError(res, 'Invalid payment method', { statusCode: 400, errorCode: 'VALIDATION_ERROR' });

        await connection.beginTransaction();
        const [rows]=await connection.query(`
            SELECT t.id,t.ticket_number,t.status,t.payment_date,t.user_id,
                   COALESCE(t.penalty_amount_at_issue,v.penalty_amount) AS penalty_amount,
                   ve.owner_email,ve.owner_name
            FROM tickets t JOIN violations v ON t.violation_id=v.id JOIN vehicles ve ON t.vehicle_id=ve.id
            WHERE t.id=? FOR UPDATE`,[ticketId]);
        if(!rows.length){await connection.rollback();return sendError(res,'Ticket not found',{statusCode:404,errorCode:'TICKET_NOT_FOUND'});}
        const ticket=rows[0];
        if (ticket.status === 'cancelled') {
            await connection.rollback();
            return sendError(res, 'Cancelled tickets cannot receive payments', { statusCode: 409, errorCode: 'TICKET_CANCELLED' });
        }
        const [activeDisputes] = await connection.query(
            `SELECT id FROM disputes WHERE ticket_id = ? AND status IN ('submitted', 'under_review') LIMIT 1`,
            [ticketId]
        );
        if (activeDisputes.length) {
            await connection.rollback();
            return sendError(res, 'Resolve the active dispute before recording payment', {
                statusCode: 409,
                errorCode: 'ACTIVE_DISPUTE'
            });
        }

        const [dupe]=await connection.query('SELECT id FROM payments WHERE official_receipt_number=? LIMIT 1',[receiptNumber]);
        if(dupe.length){await connection.rollback();return sendError(res,'Official receipt number already exists',{statusCode:409,errorCode:'OR_NUMBER_EXISTS'});}
        const [[totals]]=await connection.query(`SELECT COALESCE(SUM(amount_paid),0) total_paid FROM payments WHERE ticket_id=? AND payment_status<>'voided'`,[ticketId]);
        const paidBefore=Number(totals.total_paid||0), penalty=Number(ticket.penalty_amount||0), balance=Math.max(0,penalty-paidBefore);
        if(balance<=0||ticket.status==='paid'){await connection.rollback();return sendError(res,'This ticket is already fully paid',{statusCode:409,errorCode:'ALREADY_PAID'});}
        if(amount>balance+0.001){await connection.rollback();return sendError(res,`Payment exceeds the remaining balance of PHP ${balance.toFixed(2)}`,{statusCode:400,errorCode:'OVERPAYMENT'});}

        const total=paidBefore+amount;
        const paymentStatus=total+0.001>=penalty?'full':'partial';
        const dateValue = isValidDateString(payment_date) ? String(payment_date) : todayInManila();
        if (dateValue > todayInManila()) {
            await connection.rollback();
            return sendError(res, 'Payment date cannot be in the future', { statusCode: 400, errorCode: 'INVALID_PAYMENT_DATE' });
        }
        const [result]=await connection.query(`INSERT INTO payments(ticket_id,official_receipt_number,amount_paid,payment_date,payment_method,payment_status,notes,recorded_by) VALUES(?,?,?,?,?,?,?,?)`,[ticketId, receiptNumber, amount, dateValue, method, paymentStatus, normalizedNotes || null, req.user.id]);
        const nextStatus=paymentStatus==='full'?'paid':'unpaid';
        await connection.query('UPDATE tickets SET status=?,payment_date=? WHERE id=?',[nextStatus, paymentStatus === 'full' ? dateValue : null, ticketId]);
        await connection.query(`INSERT INTO ticket_status_history(ticket_id,previous_status,new_status,changed_by,reason) VALUES(?,?,?,?,?)`,[ticketId, ticket.status, paymentStatus === 'full' ? 'paid' : 'partially_paid',req.user.id,`Payment recorded. OR: ${receiptNumber}`]);
        await connection.commit(); committed=true;

        try { await logAudit({userId:req.user.id,action:'PAYMENT_RECORDED',entityType:'payments',entityId:result.insertId,metadata:{ticketId,officialReceiptNumber:receiptNumber,amountPaid:amount,paymentStatus,totalPaid:total,penaltyAmount:penalty},req}); } catch(e){console.error('Payment audit failed:',e.message)}
        if (ticket.owner_email) {
            try {
                await emailService.sendPaymentConfirmation(ticket.owner_email, ticket.owner_name || 'Vehicle Owner', {
                    ticket_number: ticket.ticket_number,
                    or_number: receiptNumber,
                    amount_paid: amount,
                    payment_date: dateValue,
                    payment_method: method
                });
            } catch (emailError) {
                console.error('Payment confirmation email failed:', emailError.message);
            }
        }
        try { await db.query(`INSERT INTO notifications(user_id,type,title,message,reference_type,reference_id) VALUES(?,?,?,?,?,?)`,[ticket.user_id,'payment','Ticket Payment Update',`Payment (${paymentStatus}) recorded for ${ticket.ticket_number}.`,'ticket',ticketId]); } catch(e){console.error('Payment notification failed:',e.message)}

        return sendSuccess(res,'Payment recorded successfully',{paymentId:result.insertId,ticketId,paymentStatus,totalPaidAfter:total,penaltyAmount:penalty,remainingBalance:Math.max(0,penalty-total),storedTicketStatus:nextStatus},{statusCode:201});
    } catch(error){
        if(!committed){try{await connection.rollback()}catch{}}
        console.error('Record payment error:',error);
        return sendError(res,'Server error while recording payment',{statusCode:500,errorCode:'PAYMENT_RECORD_FAILED'});
    } finally { connection.release(); }
};

exports.getTicketPayments = async (req,res) => {
    try{
        const [payments]=await db.query(`SELECT p.*,p.official_receipt_number AS or_number FROM payments p JOIN tickets t ON p.ticket_id=t.id WHERE p.ticket_id=? AND (?='admin' OR t.user_id=?) ORDER BY p.payment_date DESC,p.id DESC`,[req.params.ticketId,req.user.role,req.user.id]);
        return sendSuccess(res,'Payments fetched successfully',payments,{legacy:{payments}});
    }catch(error){console.error(error);return sendError(res,'Server error while fetching payments',{statusCode:500,errorCode:'PAYMENTS_FETCH_FAILED'});}
};
