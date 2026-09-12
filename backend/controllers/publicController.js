const { supabase, rpc, allRows } = require('../config/supabase');
const emailService = require('../utils/emailService');

const normalizePlate = value => String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '');
const normalizeTicket = value => String(value || '').trim().toUpperCase();
const validEmail = value => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value));

exports.publicTicketLookup = async (req, res) => {
    try {
        const plate = normalizePlate(req.query.plate || req.query.plate_number);
        const ticket = normalizeTicket(req.query.ticket || req.query.ticket_number);
        if (!plate && !ticket) return res.status(400).json({ success: false, message: 'Enter a plate number or ticket number.' });

        const rows = await rpc('tvtms_public_lookup', {p_plate:plate || null,p_ticket:ticket || null});

        const tickets = rows.map(row => {
            const ticket = { ...row };
            const ageDays = Number(ticket.dispute_age_days || 0);
            const deadlineDays = Number(ticket.dispute_deadline_days || 15);
            const hasOpenDispute = Number(ticket.has_open_dispute || 0) === 1;

            let disputeMessage = '';
            if (ticket.status !== 'unpaid') disputeMessage = 'Only unpaid tickets can be disputed.';
            else if (hasOpenDispute) disputeMessage = 'A dispute is already open for this ticket.';
            else if (ageDays > deadlineDays) disputeMessage = `The ${deadlineDays}-day dispute period has ended.`;

            ticket.dispute_eligible = !disputeMessage;
            ticket.dispute_message = disputeMessage;
            delete ticket.id;
            delete ticket.dispute_age_days;
            delete ticket.dispute_deadline_days;
            delete ticket.has_open_dispute;
            return ticket;
        });

        return res.json({ success: true, count: tickets.length, tickets });
    } catch (error) {
        console.error('Public ticket lookup error:', error);
        return res.status(500).json({ success: false, message: 'Server error during lookup. Please try again.' });
    }
};

exports.vehicleLookup = async (req, res) => {
    try {
        const plate = normalizePlate(req.query.plate_number || req.query.plate);
        if (!plate) return res.status(400).json({ success: false, message: 'Plate number is required.' });

        const result = await rpc('tvtms_public_vehicle', {p_plate:plate});
        const vehicles = result.vehicles;
        if (!vehicles.length) return res.json({ success: false, message: 'No vehicle record found for this plate number.' });
        const violations = result.violations;

        return res.json({ success: true, vehicle: vehicles[0], violations });
    } catch (error) {
        console.error('Vehicle lookup error:', error);
        return res.status(500).json({ success: false, message: 'Server error during lookup.' });
    }
};

exports.plateSummary = async (req, res) => {
    try {
        const plate = normalizePlate(req.query.plate || req.query.plate_number);
        if (!plate) return res.status(400).json({ success: false, message: 'Plate number is required.' });
        const summary = await rpc('tvtms_public_summary', {p_plate:plate});
        const total = Number(summary.total_violations || 0);
        return res.json({ success: true, plate_number: plate, summary: {
            total_violations: total, unpaid_count: Number(summary.unpaid_count || 0),
            paid_count: Number(summary.paid_count || 0), cancelled_count: Number(summary.cancelled_count || 0),
            total_unpaid_amount: Number(summary.total_unpaid_amount || 0),
            total_demerit_points: Number(summary.total_demerit_points || 0), is_repeat_offender: total >= 2
        }});
    } catch (error) {
        console.error('Plate summary error:', error);
        return res.status(500).json({ success: false, message: 'Server error.' });
    }
};

exports.publicFileDispute = async (req, res) => {
    const body = req.body || {};
    const ticketNumber = normalizeTicket(body.ticket_number);
    const reason = String(body.reason || '').trim();
    if (!ticketNumber || ticketNumber.length > 30 || reason.length < 10 || reason.length > 4000) {
        return res.status(400).json({ success: false, message: 'A valid ticket number and a reason of 10–4000 characters are required.' });
    }

    try {
        const result = await rpc('tvtms_public_dispute', {p_ticket:ticketNumber,p_reason:reason});
        if (result.errorCode) return res.status(result.statusCode).json({success:false,message:result.message});
        return res.status(201).json({ success:true, message:'Your dispute has been submitted for administrator review.', dispute_id:result.disputeId });
    } catch (error) {
        console.error('Public dispute error:', error);
        return res.status(500).json({ success:false, message:'Server error while filing dispute.' });
    }
};

exports.publicStats = async (req, res) => {
    try {
        const stats = await rpc('tvtms_public_stats', {});
        return res.json({
            success: true,
            stats: Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, Number(value || 0)]))
        });
    } catch (error) {
        console.error('Public stats error:', error);
        return res.status(503).json({ success:false, message:'Statistics are temporarily unavailable.' });
    }
};

exports.publicViolations = async (req, res) => {
    try {
        const violations = await allRows(() => supabase.from('violations').select('violation_code,violation_name,description,penalty_amount,demerit_points').eq('status','active').order('violation_code'));
        return res.json({ success:true, violations });
    } catch (error) {
        return res.status(503).json({ success:false, message:'Violation information is temporarily unavailable.' });
    }
};

exports.publicContact = async (req, res) => {
    try {
        const name=String(req.body.full_name||req.body.name||'').trim();
        const email=String(req.body.email||'').trim().toLowerCase();
        const subject=String(req.body.subject||'').replace(/[\r\n]+/g, ' ').trim();
        const message=String(req.body.message||'').trim();
        if (!name || name.length > 120 || !email || email.length > 190 || !validEmail(email) ||
            !subject || subject.length > 150 || message.length < 10 || message.length > 3000) {
            return res.status(400).json({ success:false, message:'Full name, valid email, subject, and a message of 10–3000 characters are required.' });
        }

        const result = await rpc('tvtms_public_contact', {p_name:name,p_email:email,p_subject:subject,p_message:message});
        if (result.errorCode) return res.status(result.statusCode).json({success:false,message:result.message});

        // The in-system Admin notification is the reliable delivery path. SMTP
        // is an optional extra copy and must not make the public form fail.
        emailService.sendPublicContact({name,email,subject,message}).catch(error => {
            console.error('Optional contact email copy failed:', error.message);
        });
        return res.status(201).json({ success:true, message:'Your message was submitted to the system Administrator.' });
    } catch (error) {
        console.error('Public contact error:', error);
        return res.status(500).json({ success:false, message:'Unable to send your message.' });
    }
};
