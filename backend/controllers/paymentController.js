const { supabase, run, rpc, allRows } = require('../config/supabase');
const { sendSuccess, sendError } = require('../utils/apiResponse');
const { logAudit } = require('../utils/auditLogger');
const emailService = require('../utils/emailService');

const paymentSchema = {
    receiptColumn: 'official_receipt_number',
    recorderColumn: 'recorded_by',
    paymentMethods: ['cash', 'gcash', 'maya', 'bank_transfer', 'other']
};

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
    try {
        const schema = paymentSchema;
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
        if (!schema.paymentMethods.includes(method)) {
            return sendError(res, 'Invalid payment method', { statusCode: 400, errorCode: 'VALIDATION_ERROR' });
        }

        const dateValue = isValidDateString(payment_date) ? String(payment_date) : todayInManila();
        if (dateValue > todayInManila()) return sendError(res, 'Payment date cannot be in the future', { statusCode: 400, errorCode: 'INVALID_PAYMENT_DATE' });
        const outcome = await rpc('tvtms_payment_record', {
            p_ticket_id: ticketId, p_receipt: receiptNumber, p_amount: amount,
            p_date: dateValue, p_method: method, p_notes: normalizedNotes || null, p_actor: req.user.id
        });
        if (outcome.errorCode) return sendError(res, outcome.message, outcome);
        const { ticket, paymentStatus, total, penalty, nextStatus, paymentId } = outcome;
        const result = { insertId: paymentId };

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
        try { await run(supabase.from('notifications').insert({user_id:ticket.user_id,type:'payment',title:'Ticket Payment Update',message:`Payment (${paymentStatus}) recorded for ${ticket.ticket_number}.`,reference_type:'ticket',reference_id:ticketId})); } catch(e){console.error('Payment notification failed:',e.message)}

        return sendSuccess(res,'Payment recorded successfully',{paymentId:result.insertId,ticketId,paymentStatus,totalPaidAfter:total,penaltyAmount:penalty,remainingBalance:Math.max(0,penalty-total),storedTicketStatus:nextStatus},{statusCode:201});
    } catch(error){
        console.error('Record payment error:',error);
        return sendError(res,'Server error while recording payment',{statusCode:500,errorCode:'PAYMENT_RECORD_FAILED'});
    }
};

exports.getTicketPayments = async (req,res) => {
    try{
        let ticketQuery = supabase.from('tickets').select('id').eq('id', req.params.ticketId);
        if (req.user.role !== 'admin') ticketQuery = ticketQuery.eq('user_id', req.user.id);
        const ticket = await run(ticketQuery.maybeSingle());
        const rows = ticket ? await allRows(() => supabase.from('payments').select('*').eq('ticket_id', ticket.id).order('payment_date', {ascending:false}).order('id', {ascending:false})) : [];
        const payments = rows.map(row => ({...row, or_number:row.official_receipt_number}));
        return sendSuccess(res,'Payments fetched successfully',payments,{legacy:{payments}});
    }catch(error){console.error(error);return sendError(res,'Server error while fetching payments',{statusCode:500,errorCode:'PAYMENTS_FETCH_FAILED'});}
};
