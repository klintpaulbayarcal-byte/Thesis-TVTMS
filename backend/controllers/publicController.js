const db = require('../config/database');
const emailService = require('../utils/emailService');

const normalizePlate = value => String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '');
const normalizeTicket = value => String(value || '').trim().toUpperCase();
const validEmail = value => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value));

exports.publicTicketLookup = async (req, res) => {
    try {
        const plate = normalizePlate(req.query.plate || req.query.plate_number);
        const ticket = normalizeTicket(req.query.ticket || req.query.ticket_number);
        if (!plate && !ticket) return res.status(400).json({ success: false, message: 'Enter a plate number or ticket number.' });

        let where = [];
        let params = [];
        if (plate) { where.push("REPLACE(REPLACE(td.plate_number, '-', ''), ' ', '') = ?"); params.push(plate); }
        if (ticket) { where.push('td.ticket_number = ?'); params.push(ticket); }

        const [rows] = await db.query(`
            SELECT td.id, td.ticket_number, td.plate_number, td.vehicle_type,
                   td.violation_code, td.violation_name, td.date_issued, td.time_issued,
                   td.location, td.status, td.payment_date, td.demerit_points,
                   td.penalty_amount,
                   COALESCE((SELECT CAST(setting_value AS UNSIGNED)
                             FROM system_settings
                             WHERE setting_key = 'dispute_deadline_days' LIMIT 1), 15) AS dispute_deadline_days,
                   DATEDIFF(CURDATE(), td.date_issued) AS dispute_age_days,
                   CASE WHEN EXISTS (
                       SELECT 1 FROM disputes d
                       WHERE d.ticket_id = td.id
                         AND d.status IN ('submitted', 'under_review')
                   ) THEN 1 ELSE 0 END AS has_open_dispute,
                   COALESCE((SELECT SUM(p.amount_paid) FROM payments p
                             WHERE p.ticket_id = td.id AND p.payment_status <> 'voided'), 0) AS total_paid,
                   GREATEST(td.penalty_amount - COALESCE((SELECT SUM(p.amount_paid) FROM payments p
                             WHERE p.ticket_id = td.id AND p.payment_status <> 'voided'), 0), 0) AS remaining_balance
            FROM ticket_details td
            WHERE ${where.join(' AND ')}
            ORDER BY td.date_issued DESC, td.time_issued DESC
            LIMIT 20`, params);

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

        const [vehicles] = await db.query(`
            SELECT plate_number, vehicle_type FROM vehicles
            WHERE REPLACE(REPLACE(plate_number, '-', ''), ' ', '') = ? LIMIT 1`, [plate]);
        if (!vehicles.length) return res.json({ success: false, message: 'No vehicle record found for this plate number.' });

        const [violations] = await db.query(`
            SELECT td.ticket_number, td.violation_name, td.violation_code, td.date_issued,
                   td.status, td.penalty_amount, td.location, td.demerit_points,
                   COALESCE((SELECT SUM(p.amount_paid) FROM payments p
                             WHERE p.ticket_id = td.id AND p.payment_status <> 'voided'), 0) AS total_paid,
                   GREATEST(td.penalty_amount - COALESCE((SELECT SUM(p.amount_paid) FROM payments p
                             WHERE p.ticket_id = td.id AND p.payment_status <> 'voided'), 0), 0) AS remaining_balance
            FROM ticket_details td
            WHERE REPLACE(REPLACE(td.plate_number, '-', ''), ' ', '') = ?
            ORDER BY td.date_issued DESC, td.time_issued DESC LIMIT 20`, [plate]);

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
        const [[summary]] = await db.query(`
            SELECT SUM(CASE WHEN t.status <> 'cancelled' THEN 1 ELSE 0 END) total_violations,
                   SUM(CASE WHEN t.status='unpaid' THEN 1 ELSE 0 END) unpaid_count,
                   SUM(CASE WHEN t.status='paid' THEN 1 ELSE 0 END) paid_count,
                   SUM(CASE WHEN t.status='cancelled' THEN 1 ELSE 0 END) cancelled_count,
                   COALESCE(SUM(CASE WHEN t.status='unpaid'
                       THEN GREATEST(COALESCE(t.penalty_amount_at_issue,v.penalty_amount) - COALESCE(p.total_paid,0), 0)
                       ELSE 0 END),0) total_unpaid_amount,
                   COALESCE(SUM(CASE WHEN t.status <> 'cancelled' THEN v.demerit_points ELSE 0 END),0) total_demerit_points
            FROM tickets t
            JOIN vehicles ve ON t.vehicle_id=ve.id
            JOIN violations v ON t.violation_id=v.id
            LEFT JOIN (
                SELECT ticket_id, SUM(amount_paid) total_paid
                FROM payments WHERE payment_status <> 'voided' GROUP BY ticket_id
            ) p ON p.ticket_id=t.id
            WHERE REPLACE(REPLACE(ve.plate_number, '-', ''), ' ', '') = ?`, [plate]);
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

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [tickets] = await connection.query(`
            SELECT t.id, t.status, t.date_issued,
                   COALESCE(NULLIF(t.owner_name_at_issue, ''), NULLIF(v.owner_name, '')) AS contact_name,
                   COALESCE(NULLIF(t.owner_email_at_issue, ''), NULLIF(v.owner_email, '')) AS contact_email,
                   COALESCE((SELECT CAST(setting_value AS UNSIGNED) FROM system_settings WHERE setting_key='dispute_deadline_days' LIMIT 1),15) AS deadline_days
            FROM tickets t
            JOIN vehicles v ON v.id = t.vehicle_id
            WHERE t.ticket_number=? FOR UPDATE`, [ticketNumber]);
        if (!tickets.length) { await connection.rollback(); return res.status(404).json({ success:false, message:'Ticket not found.' }); }
        const ticket=tickets[0];
        if (ticket.status !== 'unpaid') { await connection.rollback(); return res.status(403).json({ success:false, message:'Only unpaid tickets can be disputed.' }); }

        // Calculate dispute age in JavaScript so the same logic works reliably
        // on both MySQL (local) and PostgreSQL/Supabase (production).
        const issuedDate = new Date(ticket.date_issued);
        const today = new Date();
        const issuedUtc = Date.UTC(issuedDate.getUTCFullYear(), issuedDate.getUTCMonth(), issuedDate.getUTCDate());
        const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
        const ageDays = Number.isNaN(issuedDate.getTime()) ? 0 : Math.floor((todayUtc - issuedUtc) / 86400000);
        if (ageDays > Number(ticket.deadline_days)) { await connection.rollback(); return res.status(403).json({ success:false, message:`The ${ticket.deadline_days}-day dispute period has ended.` }); }

        const [existing] = await connection.query(`SELECT id FROM disputes WHERE ticket_id=? AND status IN ('submitted','under_review') LIMIT 1`, [ticket.id]);
        if (existing.length) { await connection.rollback(); return res.status(409).json({ success:false, message:'A dispute is already open for this ticket.' }); }

        const [result] = await connection.query(`
            INSERT INTO disputes (ticket_id, submitted_by, contact_name, contact_email, submission_source, reason, status)
            VALUES (?, NULL, ?, ?, 'public', ?, 'submitted')`, [ticket.id, ticket.contact_name, ticket.contact_email || null, reason]);
        await connection.query(`
            INSERT INTO notifications (user_id,type,title,message,reference_type,reference_id)
            SELECT id,'dispute','Public Dispute Filed',CONCAT('Public dispute filed for ticket ',?),'dispute',?
            FROM users WHERE role='admin' AND status='active'`, [ticketNumber, result.insertId]);
        await connection.commit();
        return res.status(201).json({ success:true, message:'Your dispute has been submitted for administrator review.', dispute_id:result.insertId });
    } catch (error) {
        try { await connection.rollback(); } catch {}
        console.error('Public dispute error:', error);
        return res.status(500).json({ success:false, message:'Server error while filing dispute.' });
    } finally { connection.release(); }
};

exports.publicStats = async (req, res) => {
    try {
        const [ticketResult, vehicleResult] = await Promise.all([
            db.query(`SELECT COUNT(*) total_tickets,
                SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) total_paid,
                SUM(CASE WHEN status='unpaid' THEN 1 ELSE 0 END) total_unpaid,
                SUM(CASE WHEN DATE(date_issued)=CURDATE() THEN 1 ELSE 0 END) today_tickets,
                SUM(CASE WHEN date_issued >= DATE_SUB(CURDATE(),INTERVAL 30 DAY) THEN 1 ELSE 0 END) this_month
                FROM tickets`),
            db.query('SELECT COUNT(*) AS total_vehicles FROM vehicles')
        ]);
        const ticketStats = ticketResult[0]?.[0] || {};
        const vehicleStats = vehicleResult[0]?.[0] || {};
        const stats = { ...ticketStats, ...vehicleStats };
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
        const [violations] = await db.query(`SELECT violation_code, violation_name, description, penalty_amount, demerit_points FROM violations WHERE status='active' ORDER BY violation_code`);
        return res.json({ success:true, violations });
    } catch (error) {
        return res.status(503).json({ success:false, message:'Violation information is temporarily unavailable.' });
    }
};

exports.publicContact = async (req, res) => {
    const connection = await db.getConnection();
    try {
        const name=String(req.body.full_name||req.body.name||'').trim();
        const email=String(req.body.email||'').trim().toLowerCase();
        const subject=String(req.body.subject||'').replace(/[\r\n]+/g, ' ').trim();
        const message=String(req.body.message||'').trim();
        if (!name || name.length > 120 || !email || email.length > 190 || !validEmail(email) ||
            !subject || subject.length > 150 || message.length < 10 || message.length > 3000) {
            return res.status(400).json({ success:false, message:'Full name, valid email, subject, and a message of 10–3000 characters are required.' });
        }

        await connection.beginTransaction();
        const [contactResult] = await connection.query(`
            INSERT INTO contact_messages (full_name, email, subject, message)
            VALUES (?, ?, ?, ?)
        `, [name, email, subject, message]);
        const notificationMessage = [
            `From: ${name} <${email}>`,
            `Subject: ${subject}`,
            `Message: ${message}`
        ].join('\n');
        const [notificationResult] = await connection.query(`
            INSERT INTO notifications (user_id, type, title, message, reference_type, reference_id)
            SELECT id, 'contact', 'Public Contact Message', ?, 'contact', ?
            FROM users
            WHERE role = 'admin' AND status = 'active'
        `, [notificationMessage, contactResult.insertId]);

        if (notificationResult.affectedRows < 1) {
            await connection.rollback();
            return res.status(503).json({ success:false, message:'No active Administrator is available to receive the message. Please use the published hotline.' });
        }

        await connection.commit();

        // The in-system Admin notification is the reliable delivery path. SMTP
        // is an optional extra copy and must not make the public form fail.
        emailService.sendPublicContact({name,email,subject,message}).catch(error => {
            console.error('Optional contact email copy failed:', error.message);
        });
        return res.status(201).json({ success:true, message:'Your message was submitted to the system Administrator.' });
    } catch (error) {
        try { await connection.rollback(); } catch {}
        console.error('Public contact error:', error);
        return res.status(500).json({ success:false, message:'Unable to send your message.' });
    } finally {
        connection.release();
    }
};
