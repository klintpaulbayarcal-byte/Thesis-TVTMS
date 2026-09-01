const db = require('../config/database');
const { logAudit } = require('../utils/auditLogger');
const { sendSuccess, sendError } = require('../utils/apiResponse');
const emailService = require('../utils/emailService');

const lifecycleToLegacyStatus = {
    draft: 'unpaid',
    issued: 'unpaid',
    pending_payment: 'unpaid',
    partially_paid: 'unpaid',
    unpaid: 'unpaid',
    paid: 'paid',
    closed: 'paid',
    cancelled: 'cancelled',
    voided: 'cancelled'
};

const legacyToLifecycleStatus = {
    unpaid: 'pending_payment',
    paid: 'paid',
    cancelled: 'cancelled'
};

const lifecycleTransitionMap = {
    draft: ['issued', 'cancelled', 'voided'],
    issued: ['pending_payment', 'partially_paid', 'paid', 'cancelled', 'voided'],
    pending_payment: ['partially_paid', 'paid', 'cancelled', 'voided'],
    partially_paid: ['partially_paid', 'paid', 'cancelled', 'voided'],
    unpaid: ['pending_payment', 'partially_paid', 'paid', 'cancelled', 'voided'],
    paid: ['closed'],
    closed: [],
    cancelled: [],
    voided: []
};

const validLifecycleStatuses = Object.keys(lifecycleToLegacyStatus);

const parsePositiveInt = (value, fallback) => {
    const parsed = parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const getLatestLifecycleStatusSafe = async (ticketId, legacyStatus, executor = db) => {
    try {
        const [rows] = await executor.query(
            `SELECT new_status
             FROM ticket_status_history
             WHERE ticket_id = ?
             ORDER BY id DESC
             LIMIT 1`,
            [ticketId]
        );

        if (rows.length > 0) {
            return rows[0].new_status;
        }
    } catch (error) {
        if (!(error && error.code === 'ER_NO_SUCH_TABLE')) {
            throw error;
        }
    }

    return legacyToLifecycleStatus[legacyStatus] || 'pending_payment';
};

const isTransitionAllowed = (fromStatus, toStatus) => {
    const allowedTargets = lifecycleTransitionMap[fromStatus] || [];
    return allowedTargets.includes(toStatus);
};

const resolveOwnerIdSafe = async (connection, ownerName, ownerEmail, ownerAddress) => {
    if (!ownerName && !ownerEmail) {
        return null;
    }

    try {
        let existingOwner = [];

        if (ownerEmail) {
            [existingOwner] = await connection.query(
                'SELECT id FROM owners WHERE email = ? LIMIT 1',
                [ownerEmail]
            );
        } else {
            [existingOwner] = await connection.query(
                'SELECT id FROM owners WHERE name = ? ORDER BY id DESC LIMIT 1',
                [ownerName]
            );
        }

        if (existingOwner.length > 0) {
            const ownerId = existingOwner[0].id;
            await connection.query(
                `UPDATE owners
                 SET name = COALESCE(?, name),
                     email = COALESCE(?, email),
                     address = COALESCE(?, address)
                 WHERE id = ?`,
                [ownerName || null, ownerEmail || null, ownerAddress || null, ownerId]
            );
            return ownerId;
        }

        const [result] = await connection.query(
            'INSERT INTO owners (name, email, address) VALUES (?, ?, ?)',
            [ownerName || 'Unknown Owner', ownerEmail || null, ownerAddress || null]
        );

        return result.insertId;
    } catch (error) {
        if (error && (error.code === 'ER_NO_SUCH_TABLE' || error.code === 'ER_BAD_FIELD_ERROR')) {
            return null;
        }

        throw error;
    }
};

const getEffectivePenalty = async ({ violationId, plateNumber, executor = db }) => {
    const [[baseViolation]] = await executor.query(
        'SELECT penalty_amount FROM violations WHERE id = ? LIMIT 1',
        [violationId]
    );

    if (!baseViolation) {
        throw new Error('Violation not found');
    }

    const basePenalty = Number(baseViolation.penalty_amount);

    const [[history]] = await executor.query(
        `SELECT COUNT(*) as prior_count
         FROM tickets t
         JOIN vehicles v ON t.vehicle_id = v.id
         WHERE t.violation_id = ?
           AND REPLACE(REPLACE(UPPER(v.plate_number), '-', ''), ' ', '') = ?
           AND t.status <> 'cancelled'`,
        [violationId, plateNumber]
    );

    const nextOffenseCount = Number(history.prior_count || 0) + 1;

    try {
        const [ruleRows] = await executor.query(
            `SELECT penalty_amount
             FROM violation_penalty_rules
             WHERE violation_id = ?
               AND offense_count = ?
               AND is_active = 1
               AND effective_from <= CURDATE()
               AND (effective_to IS NULL OR effective_to >= CURDATE())
             ORDER BY effective_from DESC
             LIMIT 1`,
            [violationId, nextOffenseCount]
        );

        if (ruleRows.length > 0) {
            return {
                basePenalty,
                effectivePenalty: Number(ruleRows[0].penalty_amount),
                nextOffenseCount,
                usedEscalationRule: true
            };
        }
    } catch (error) {
        if (!(error && error.code === 'ER_NO_SUCH_TABLE')) {
            throw error;
        }
    }

    return {
        basePenalty,
        effectivePenalty: basePenalty,
        nextOffenseCount,
        usedEscalationRule: false
    };
};

const insertStatusHistorySafe = async ({
    ticketId,
    previousStatus,
    newStatus,
    changedBy,
    reason = null,
    approverId = null,
    executor = db
}) => {
    try {
        await executor.query(
            `INSERT INTO ticket_status_history
            (ticket_id, previous_status, new_status, changed_by, reason, approver_id)
            VALUES (?, ?, ?, ?, ?, ?)`,
            [ticketId, previousStatus, newStatus, changedBy, reason, approverId]
        );
    } catch (error) {
        // Keep legacy compatibility if migration has not been applied yet.
        if (error && (error.code === 'ER_NO_SUCH_TABLE' || error.code === 'ER_BAD_FIELD_ERROR')) {
            return;
        }

        throw error;
    }
};

// Generate a unique, sequential ticket number atomically on the active transaction.
const generateTicketNumber = async connection => {
    const year = Number(new Intl.DateTimeFormat('en', {
        timeZone: 'Asia/Manila', year: 'numeric'
    }).format(new Date()));

    let row;
    if (db.client === 'postgres') {
        const [rows] = await connection.query(
            `INSERT INTO ticket_number_sequences (sequence_year, last_number)
             VALUES (?, 1)
             ON CONFLICT (sequence_year) DO UPDATE
             SET last_number = ticket_number_sequences.last_number + 1,
                 updated_at = CURRENT_TIMESTAMP
             RETURNING last_number AS next_number`,
            [year]
        );
        [row] = rows;
    } else {
        await connection.query(
            `INSERT INTO ticket_number_sequences (sequence_year, last_number)
             VALUES (?, LAST_INSERT_ID(1))
             ON DUPLICATE KEY UPDATE last_number = LAST_INSERT_ID(last_number + 1)`,
            [year]
        );
        [[row]] = await connection.query('SELECT LAST_INSERT_ID() AS next_number');
    }
    const nextNumber = Number(row.next_number || 1);
    return `TVT-${year}-${String(nextNumber).padStart(6, '0')}`;
};

// Get all tickets
exports.getAllTickets = async (req, res) => {
    try {
        const {
            status,
            dateFrom,
            dateTo,
            enforcerId,
            violation,
            location,
            search,
            scope,
            sortBy = 'date_issued',
            sortOrder = 'DESC',
            page = 1,
            pageSize = 20
        } = req.query;

        const safePage = parsePositiveInt(page, 1);
        const safePageSize = Math.min(parsePositiveInt(pageSize, 20), 100);
        const offset = (safePage - 1) * safePageSize;
        const allowedSortBy = ['date_issued', 'time_issued', 'ticket_number', 'status', 'plate_number'];
        const normalizedSortBy = allowedSortBy.includes(sortBy) ? sortBy : 'date_issued';
        const normalizedSortOrder = String(sortOrder).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        let query = `
            SELECT td.*, t.user_id
            FROM ticket_details td
            JOIN tickets t ON td.id = t.id
            WHERE 1=1
        `;
        let params = [];

        let countQuery = `
            SELECT COUNT(*) as total
            FROM ticket_details td
            JOIN tickets t ON td.id = t.id
            WHERE 1=1
        `;
        let countParams = [];

        if (status) {
            const legacyStatus = lifecycleToLegacyStatus[status] || status;
            query += ' AND td.status = ?';
            countQuery += ' AND td.status = ?';
            params.push(legacyStatus);
            countParams.push(legacyStatus);
        }

        if (dateFrom) {
            query += ' AND td.date_issued >= ?';
            countQuery += ' AND td.date_issued >= ?';
            params.push(dateFrom);
            countParams.push(dateFrom);
        }

        if (dateTo) {
            query += ' AND td.date_issued <= ?';
            countQuery += ' AND td.date_issued <= ?';
            params.push(dateTo);
            countParams.push(dateTo);
        }

        if (enforcerId) {
            query += ' AND t.user_id = ?';
            countQuery += ' AND t.user_id = ?';
            params.push(enforcerId);
            countParams.push(enforcerId);
        }

        if (violation) {
            const violationTerm = `%${violation}%`;
            query += ' AND (td.violation_name LIKE ? OR td.violation_code LIKE ?)';
            countQuery += ' AND (td.violation_name LIKE ? OR td.violation_code LIKE ?)';
            params.push(violationTerm, violationTerm);
            countParams.push(violationTerm, violationTerm);
        }

        if (location) {
            query += ' AND td.location LIKE ?';
            countQuery += ' AND td.location LIKE ?';
            params.push(`%${location}%`);
            countParams.push(`%${location}%`);
        }

        // Officers can only view tickets they issued.
        if (req.user.role === 'apprehending_officer') {
            query += ' AND t.user_id = ?';
            countQuery += ' AND t.user_id = ?';
            params.push(req.user.id);
            countParams.push(req.user.id);
        }


        if (search) {
            const searchTerm = `%${search}%`;
            query += `
                AND (
                    td.ticket_number LIKE ?
                    OR td.plate_number LIKE ?
                    OR td.owner_name LIKE ?
                    OR td.owner_email LIKE ?
                    OR td.violation_name LIKE ?
                )
            `;
            countQuery += `
                AND (
                    td.ticket_number LIKE ?
                    OR td.plate_number LIKE ?
                    OR td.owner_name LIKE ?
                    OR td.owner_email LIKE ?
                    OR td.violation_name LIKE ?
                )
            `;

            params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
            countParams.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
        }

        query += ` ORDER BY td.${normalizedSortBy} ${normalizedSortOrder}, td.time_issued DESC LIMIT ? OFFSET ?`;
        params.push(safePageSize, offset);

        const [[countResult]] = await db.query(countQuery, countParams);
        const total = countResult.total || 0;
        const totalPages = Math.ceil(total / safePageSize) || 1;

        const [tickets] = await db.query(query, params);

        return sendSuccess(res, 'Tickets fetched successfully', tickets, {
            pagination: {
                page: safePage,
                pageSize: safePageSize,
                total,
                totalPages
            },
            legacy: {
                tickets
            }
        });

    } catch (error) {
        console.error('Get tickets error:', error);
        return sendError(res, 'Server error', {
            statusCode: 500,
            errorCode: 'TICKETS_FETCH_FAILED'
        });
    }
};

// Get ticket by ID
exports.getTicketById = async (req, res) => {
    try {
        const { id } = req.params;

        const [tickets] = await db.query(
            `SELECT td.*, t.user_id
             FROM ticket_details td
             JOIN tickets t ON td.id = t.id
             WHERE td.id = ?`,
            [id]
        );

        if (tickets.length === 0) {
            return sendError(res, 'Ticket not found', {
                statusCode: 404,
                errorCode: 'TICKET_NOT_FOUND'
            });
        }

        // Check if enforcer is trying to access another enforcer's ticket
        if (req.user.role === 'apprehending_officer' && tickets[0].user_id !== req.user.id) {
            return sendError(res, 'Access denied', {
                statusCode: 403,
                errorCode: 'TICKET_ACCESS_DENIED'
            });
        }


        // Feature 1: Ticket Activity Timeline - reuse ticket_status_history,
        // don't create a separate tracking table.
        let timeline = [];
        try {
            const [history] = await db.query(
                `SELECT h.id, h.previous_status, h.new_status, h.reason, h.created_at,
                        u.name AS changed_by_name
                 FROM ticket_status_history h
                 LEFT JOIN users u ON h.changed_by = u.id
                 WHERE h.ticket_id = ?
                 ORDER BY h.created_at ASC, h.id ASC`,
                [id]
            );
            timeline = history;
        } catch (historyError) {
            if (!(historyError && historyError.code === 'ER_NO_SUCH_TABLE')) {
                throw historyError;
            }
        }

        return sendSuccess(res, 'Ticket fetched successfully', { ...tickets[0], timeline }, {
            legacy: {
                ticket: { ...tickets[0], timeline }
            }
        });

    } catch (error) {
        console.error('Get ticket error:', error);
        return sendError(res, 'Server error', {
            statusCode: 500,
            errorCode: 'TICKET_FETCH_FAILED'
        });
    }
};

// Create new ticket
exports.createTicket = async (req, res) => {
    const connection = await db.getConnection();
    let committed = false;

    try {
        const {
            plate_number, vehicle_type, owner_name, driver_license_number,
            owner_email, owner_address, violation_id, location, remarks
        } = req.body;

        const normalizedPlateNumber = String(plate_number || '').trim().toUpperCase().replace(/[\s-]+/g, '');
        const normalizedVehicleType = String(vehicle_type || '').trim().toLowerCase();
        const normalizedOwnerName = String(owner_name || '').trim();
        const normalizedOwnerEmail = String(owner_email || '').trim().toLowerCase();
        const normalizedOwnerAddress = String(owner_address || '').trim();
        const normalizedLicense = String(driver_license_number || '').trim().toUpperCase();
        const normalizedLocation = String(location || '').trim();
        const normalizedRemarks = String(remarks || '').trim();
        const violationId = Number(violation_id);
        const allowedVehicleTypes = ['motorcycle', 'tricycle', 'car', 'truck', 'bus', 'van'];

        if (!normalizedPlateNumber || normalizedPlateNumber.length > 20 || !allowedVehicleTypes.includes(normalizedVehicleType) || !Number.isInteger(violationId) || violationId <= 0) {
            return sendError(res, 'Valid plate number, vehicle type, and violation are required', {
                statusCode: 400, errorCode: 'VALIDATION_ERROR'
            });
        }
        if (normalizedOwnerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedOwnerEmail)) {
            return sendError(res, 'Owner email address is invalid', { statusCode: 400, errorCode: 'VALIDATION_ERROR' });
        }
        if (normalizedOwnerName.length > 100 || normalizedOwnerEmail.length > 100 || normalizedOwnerAddress.length > 2000 || normalizedLicense.length > 30 || normalizedLocation.length > 200 || normalizedRemarks.length > 4000) {
            return sendError(res, 'One or more ticket fields exceed the allowed length', { statusCode: 400, errorCode: 'VALIDATION_ERROR' });
        }

        await connection.beginTransaction();

        const [[violation]] = await connection.query(
            "SELECT id, status FROM violations WHERE id = ? LIMIT 1",
            [violationId]
        );
        if (!violation || violation.status !== 'active') {
            await connection.rollback();
            return sendError(res, 'Selected violation is unavailable', { statusCode: 400, errorCode: 'VIOLATION_UNAVAILABLE' });
        }

        const ownerId = await resolveOwnerIdSafe(
            connection,
            normalizedOwnerName || null,
            normalizedOwnerEmail || null,
            normalizedOwnerAddress || null
        );

        let vehicleId;
        const [vehicles] = await connection.query(
            `SELECT id, owner_name, owner_email, owner_address
             FROM vehicles
             WHERE REPLACE(REPLACE(UPPER(plate_number), '-', ''), ' ', '') = ?
             LIMIT 1 FOR UPDATE`,
            [normalizedPlateNumber]
        );

        let ownerNameSnapshot = normalizedOwnerName || null;
        let ownerEmailSnapshot = normalizedOwnerEmail || null;
        let ownerAddressSnapshot = normalizedOwnerAddress || null;

        if (vehicles.length) {
            vehicleId = vehicles[0].id;
            ownerNameSnapshot ||= vehicles[0].owner_name || null;
            ownerEmailSnapshot ||= vehicles[0].owner_email || null;
            ownerAddressSnapshot ||= vehicles[0].owner_address || null;
            await connection.query(
                `UPDATE vehicles SET
                    vehicle_type = ?,
                    owner_name = COALESCE(NULLIF(?, ''), owner_name),
                    owner_email = COALESCE(NULLIF(?, ''), owner_email),
                    owner_address = COALESCE(NULLIF(?, ''), owner_address),
                    owner_id = COALESCE(?, owner_id),
                    driver_license_number = COALESCE(NULLIF(?, ''), driver_license_number)
                 WHERE id = ?`,
                [normalizedVehicleType, normalizedOwnerName, normalizedOwnerEmail, normalizedOwnerAddress, ownerId, normalizedLicense, vehicleId]
            );
        } else {
            const [vehicleResult] = await connection.query(
                `INSERT INTO vehicles
                 (plate_number, vehicle_type, owner_name, owner_email, owner_address, owner_id, driver_license_number)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [normalizedPlateNumber, normalizedVehicleType, normalizedOwnerName || null, normalizedOwnerEmail || null,
                    normalizedOwnerAddress || null, ownerId, normalizedLicense || null]
            );
            vehicleId = vehicleResult.insertId;
        }

        const penaltyInfo = await getEffectivePenalty({
            violationId,
            plateNumber: normalizedPlateNumber,
            executor: connection
        });
        const ticketNumber = await generateTicketNumber(connection);

        const [ticketResult] = await connection.query(
            `INSERT INTO tickets
             (ticket_number, user_id, vehicle_id, violation_id,
              owner_name_at_issue, owner_email_at_issue, owner_address_at_issue,
              penalty_amount_at_issue, date_issued, time_issued, location, remarks)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), CURTIME(), ?, ?)`,
            [ticketNumber, req.user.id, vehicleId, violationId,
                ownerNameSnapshot, ownerEmailSnapshot, ownerAddressSnapshot,
                penaltyInfo.effectivePenalty, normalizedLocation || null, normalizedRemarks || null]
        );

        await insertStatusHistorySafe({
            ticketId: ticketResult.insertId,
            previousStatus: null,
            newStatus: 'draft',
            changedBy: req.user.id,
            reason: 'Ticket drafted in system',
            executor: connection
        });
        await insertStatusHistorySafe({
            ticketId: ticketResult.insertId,
            previousStatus: 'draft',
            newStatus: 'issued',
            changedBy: req.user.id,
            reason: 'Ticket was issued',
            executor: connection
        });

        const [newTicket] = await connection.query('SELECT * FROM ticket_details WHERE id = ?', [ticketResult.insertId]);
        await connection.commit();
        committed = true;

        try {
            await logAudit({
                userId: req.user.id,
                action: 'TICKET_CREATED',
                entityType: 'tickets',
                entityId: ticketResult.insertId,
                metadata: {
                    ticketNumber, violationId, plateNumber: normalizedPlateNumber,
                    basePenalty: penaltyInfo.basePenalty,
                    effectivePenalty: penaltyInfo.effectivePenalty,
                    offenseCount: penaltyInfo.nextOffenseCount,
                    usedEscalationRule: penaltyInfo.usedEscalationRule
                },
                req
            });
        } catch (auditError) {
            console.error('Ticket audit logging failed:', auditError.message);
        }

        if (normalizedOwnerEmail && newTicket[0]) {
            try {
                await emailService.sendViolationNotice(
                    normalizedOwnerEmail,
                    normalizedOwnerName || 'Vehicle Owner',
                    {
                        ticket_number: newTicket[0].ticket_number,
                        plate_number: newTicket[0].plate_number,
                        violation_name: newTicket[0].violation_name,
                        date_issued: newTicket[0].date_issued,
                        time_issued: newTicket[0].time_issued,
                        location: newTicket[0].location,
                        penalty_amount: newTicket[0].penalty_amount || penaltyInfo.effectivePenalty,
                        officer_name: newTicket[0].officer_name || req.user.name
                    }
                );
            } catch (emailError) {
                console.error('Violation notice email failed:', emailError.message);
            }
        }

        return sendSuccess(res, 'Ticket issued successfully', newTicket[0], {
            statusCode: 201,
            legacy: { ticket: newTicket[0] }
        });
    } catch (error) {
        if (!committed) {
            try { await connection.rollback(); } catch {}
        }
        console.error('Create ticket error:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return sendError(res, 'A duplicate ticket or vehicle record was detected. Please retry.', {
                statusCode: 409, errorCode: 'DUPLICATE_RECORD'
            });
        }
        return sendError(res, 'Server error while issuing ticket', {
            statusCode: 500, errorCode: 'TICKET_CREATE_FAILED'
        });
    } finally {
        connection.release();
    }
};

// Update ticket status
exports.updateTicketStatus = async (req, res) => {
    const connection = await db.getConnection();
    let committed = false;
    try {
        const id = Number(req.params.id);
        const status = String(req.body.status || '').trim();
        const reason = String(req.body.reason || '').trim();
        if (!Number.isInteger(id) || id <= 0 || !validLifecycleStatuses.includes(status)) {
            return sendError(res, 'Valid ticket ID and status are required', { statusCode: 400, errorCode: 'INVALID_STATUS' });
        }
        if (status === 'paid') {
            return sendError(res, 'Record an official payment instead of changing the ticket status directly', {
                statusCode: 409, errorCode: 'PAYMENT_REQUIRED'
            });
        }
        if (['cancelled', 'voided', 'closed'].includes(status) && req.user.role !== 'admin') {
            return sendError(res, 'Administrator approval is required for cancellation or closure', {
                statusCode: 403, errorCode: 'ADMIN_REQUIRED'
            });
        }
        if (['cancelled', 'voided'].includes(status) && reason.length < 5) {
            return sendError(res, 'Cancellation or voiding requires a reason with at least 5 characters', {
                statusCode: 400, errorCode: 'VALIDATION_ERROR'
            });
        }

        await connection.beginTransaction();
        const [tickets] = await connection.query(
            'SELECT id, status, user_id FROM tickets WHERE id = ? FOR UPDATE',
            [id]
        );
        if (!tickets.length) {
            await connection.rollback();
            return sendError(res, 'Ticket not found', { statusCode: 404, errorCode: 'TICKET_NOT_FOUND' });
        }
        const ticket = tickets[0];
        if (req.user.role === 'apprehending_officer' && ticket.user_id !== req.user.id) {
            await connection.rollback();
            return sendError(res, 'Access denied', { statusCode: 403, errorCode: 'TICKET_ACCESS_DENIED' });
        }

        if (['cancelled', 'voided'].includes(status)) {
            const [[paymentSummary]] = await connection.query(
                `SELECT COALESCE(SUM(amount_paid), 0) AS total_paid
                 FROM payments WHERE ticket_id = ? AND payment_status <> 'voided'`,
                [id]
            );
            if (Number(paymentSummary.total_paid || 0) > 0) {
                await connection.rollback();
                return sendError(res, 'Tickets with recorded payments cannot be cancelled or voided', {
                    statusCode: 409,
                    errorCode: 'PAYMENT_EXISTS'
                });
            }
        }

        const currentLifecycleStatus = await getLatestLifecycleStatusSafe(id, ticket.status, connection);
        if (!isTransitionAllowed(currentLifecycleStatus, status)) {
            await connection.rollback();
            return sendError(res, `Invalid lifecycle transition: ${currentLifecycleStatus} -> ${status}`, {
                statusCode: 409, errorCode: 'INVALID_STATUS_TRANSITION'
            });
        }

        const dbStatus = lifecycleToLegacyStatus[status];
        await connection.query('UPDATE tickets SET status = ? WHERE id = ?', [dbStatus, id]);
        await insertStatusHistorySafe({
            ticketId: id,
            previousStatus: currentLifecycleStatus,
            newStatus: status,
            changedBy: req.user.id,
            reason: reason || null,
            approverId: req.user.id,
            executor: connection
        });
        await connection.commit();
        committed = true;

        try {
            await logAudit({
                userId: req.user.id,
                action: 'TICKET_STATUS_UPDATED',
                entityType: 'tickets',
                entityId: id,
                metadata: {
                    requestedStatus: status,
                    previousLifecycleStatus: currentLifecycleStatus,
                    storedStatus: dbStatus,
                    approverId: req.user.id,
                    reason: reason || null
                },
                req
            });
        } catch (auditError) {
            console.error('Ticket status audit logging failed:', auditError.message);
        }

        return sendSuccess(res, 'Ticket updated successfully', {
            id, requestedStatus: status, storedStatus: dbStatus
        });
    } catch (error) {
        if (!committed) {
            try { await connection.rollback(); } catch {}
        }
        console.error('Update ticket error:', error);
        return sendError(res, 'Server error while updating ticket', {
            statusCode: 500, errorCode: 'TICKET_UPDATE_FAILED'
        });
    } finally {
        connection.release();
    }
};

// Update editable ticket details
exports.updateTicketDetails = async (req, res) => {
    const connection = await db.getConnection();
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return sendError(res, 'Invalid ticket ID', { statusCode: 400, errorCode: 'VALIDATION_ERROR' });
        }

        await connection.beginTransaction();
        const [tickets] = await connection.query(
            'SELECT id, status, user_id, location, remarks FROM tickets WHERE id = ? FOR UPDATE',
            [id]
        );
        if (!tickets.length) {
            await connection.rollback();
            return sendError(res, 'Ticket not found', { statusCode: 404, errorCode: 'TICKET_NOT_FOUND' });
        }

        const current = tickets[0];
        if (req.user.role === 'apprehending_officer' && current.user_id !== req.user.id) {
            await connection.rollback();
            return sendError(res, 'Access denied', { statusCode: 403, errorCode: 'TICKET_ACCESS_DENIED' });
        }
        if (['paid', 'cancelled'].includes(current.status)) {
            await connection.rollback();
            return sendError(res, 'Paid or cancelled tickets cannot be edited', {
                statusCode: 409,
                errorCode: 'INVALID_OPERATION'
            });
        }

        const normalizedLocation = typeof req.body.location === 'string'
            ? req.body.location.trim()
            : String(current.location || '').trim();
        const normalizedRemarks = typeof req.body.remarks === 'string'
            ? req.body.remarks.trim()
            : String(current.remarks || '').trim();
        if (normalizedLocation.length > 200 || normalizedRemarks.length > 4000) {
            await connection.rollback();
            return sendError(res, 'Location or remarks exceed the allowed length', {
                statusCode: 400,
                errorCode: 'VALIDATION_ERROR'
            });
        }

        await connection.query(
            'UPDATE tickets SET location = ?, remarks = ? WHERE id = ?',
            [normalizedLocation || null, normalizedRemarks || null, id]
        );
        await connection.commit();

        try {
            await logAudit({
                userId: req.user.id,
                action: 'TICKET_DETAILS_UPDATED',
                entityType: 'tickets',
                entityId: id,
                metadata: {
                    previousLocation: current.location || null,
                    newLocation: normalizedLocation || null,
                    previousRemarks: current.remarks || null,
                    newRemarks: normalizedRemarks || null
                },
                req
            });
        } catch (auditError) {
            console.error('Ticket details audit error:', auditError);
        }

        return sendSuccess(res, 'Ticket details updated successfully', {
            id,
            location: normalizedLocation || null,
            remarks: normalizedRemarks || null
        });
    } catch (error) {
        try { await connection.rollback(); } catch {}
        console.error('Update ticket details error:', error);
        return sendError(res, 'Server error', { statusCode: 500, errorCode: 'TICKET_UPDATE_FAILED' });
    } finally {
        connection.release();
    }
};

// Cancel ticket (admin only). Records are retained for accountability.
exports.deleteTicket = async (req, res) => {
    const connection = await db.getConnection();
    try {
        const id = Number(req.params.id);
        const reason = String(req.body?.reason || req.query.reason || '').trim();
        if (!Number.isInteger(id) || id <= 0) {
            return sendError(res, 'Invalid ticket ID', { statusCode: 400, errorCode: 'VALIDATION_ERROR' });
        }
        if (reason.length < 5 || reason.length > 500) {
            return sendError(res, 'A cancellation reason between 5 and 500 characters is required', {
                statusCode: 400,
                errorCode: 'VALIDATION_ERROR'
            });
        }

        await connection.beginTransaction();
        const [rows] = await connection.query(
            'SELECT id, ticket_number, status FROM tickets WHERE id = ? FOR UPDATE',
            [id]
        );
        if (!rows.length) {
            await connection.rollback();
            return sendError(res, 'Ticket not found', { statusCode: 404, errorCode: 'TICKET_NOT_FOUND' });
        }

        const ticket = rows[0];
        if (ticket.status === 'paid') {
            await connection.rollback();
            return sendError(res, 'Paid tickets cannot be cancelled', { statusCode: 409, errorCode: 'INVALID_OPERATION' });
        }
        if (ticket.status === 'cancelled') {
            await connection.rollback();
            return sendError(res, 'Ticket is already cancelled', { statusCode: 409, errorCode: 'ALREADY_CANCELLED' });
        }
        const [[paymentSummary]] = await connection.query(
            `SELECT COALESCE(SUM(amount_paid), 0) AS total_paid
             FROM payments WHERE ticket_id = ? AND payment_status <> 'voided'`,
            [id]
        );
        if (Number(paymentSummary.total_paid || 0) > 0) {
            await connection.rollback();
            return sendError(res, 'Tickets with recorded payments cannot be cancelled', {
                statusCode: 409,
                errorCode: 'PAYMENT_EXISTS'
            });
        }

        await connection.query("UPDATE tickets SET status = 'cancelled' WHERE id = ?", [id]);
        await insertStatusHistorySafe({
            ticketId: id,
            previousStatus: ticket.status,
            newStatus: 'cancelled',
            changedBy: req.user.id,
            reason,
            approverId: req.user.id,
            executor: connection
        });
        await connection.commit();

        try {
            await logAudit({
                userId: req.user.id,
                action: 'TICKET_CANCELLED',
                entityType: 'tickets',
                entityId: id,
                metadata: { ticketNumber: ticket.ticket_number, reason },
                req
            });
        } catch (auditError) {
            console.error('Ticket cancellation audit error:', auditError);
        }

        return sendSuccess(res, 'Ticket cancelled successfully', {
            id,
            ticketNumber: ticket.ticket_number,
            status: 'cancelled'
        });
    } catch (error) {
        try { await connection.rollback(); } catch {}
        console.error('Cancel ticket error:', error);
        return sendError(res, 'Server error', { statusCode: 500, errorCode: 'TICKET_CANCEL_FAILED' });
    } finally {
        connection.release();
    }
};

// Permanently delete an unpaid/cancelled ticket with no linked official records (admin only).
exports.permanentlyDeleteTicket = async (req, res) => {
    const connection = await db.getConnection();
    try {
        const id = Number(req.params.id);
        const reason = String(req.body?.reason || '').trim();
        if (!Number.isInteger(id) || id <= 0) {
            return sendError(res, 'Invalid ticket ID', { statusCode: 400, errorCode: 'VALIDATION_ERROR' });
        }
        if (reason.length < 5 || reason.length > 500) {
            return sendError(res, 'A deletion reason between 5 and 500 characters is required', {
                statusCode: 400,
                errorCode: 'VALIDATION_ERROR'
            });
        }

        await connection.beginTransaction();
        const [rows] = await connection.query(
            'SELECT id, ticket_number, status FROM tickets WHERE id = ? FOR UPDATE',
            [id]
        );
        if (!rows.length) {
            await connection.rollback();
            return sendError(res, 'Ticket not found', { statusCode: 404, errorCode: 'TICKET_NOT_FOUND' });
        }

        const ticket = rows[0];
        if (!['unpaid', 'cancelled'].includes(ticket.status)) {
            await connection.rollback();
            return sendError(res, 'Only unpaid or cancelled tickets can be permanently deleted', {
                statusCode: 409,
                errorCode: 'TICKET_DELETE_NOT_ALLOWED'
            });
        }

        const [[linkedRecords]] = await connection.query(
            `SELECT
                (SELECT COUNT(*) FROM payments WHERE ticket_id = ?) AS payments_count,
                (SELECT COUNT(*) FROM disputes WHERE ticket_id = ?) AS disputes_count,
                (SELECT COUNT(*) FROM evidence WHERE ticket_id = ?) AS evidence_count`,
            [id, id, id]
        );
        const linkedCount = Number(linkedRecords.payments_count || 0)
            + Number(linkedRecords.disputes_count || 0)
            + Number(linkedRecords.evidence_count || 0);
        if (linkedCount > 0) {
            await connection.rollback();
            return sendError(res, 'This ticket has linked payment, dispute, or evidence records and cannot be deleted', {
                statusCode: 409,
                errorCode: 'LINKED_RECORDS_EXIST'
            });
        }

        const [result] = await connection.query('DELETE FROM tickets WHERE id = ?', [id]);
        if (result.affectedRows !== 1) {
            await connection.rollback();
            return sendError(res, 'Ticket could not be deleted', { statusCode: 409, errorCode: 'DELETE_FAILED' });
        }
        await connection.commit();

        try {
            await logAudit({
                userId: req.user.id,
                action: 'TICKET_PERMANENTLY_DELETED',
                entityType: 'tickets',
                entityId: id,
                metadata: { ticketNumber: ticket.ticket_number, previousStatus: ticket.status, reason },
                req
            });
        } catch (auditError) {
            console.error('Permanent ticket deletion audit error:', auditError);
        }

        return sendSuccess(res, 'Ticket permanently deleted', {
            id,
            ticketNumber: ticket.ticket_number
        });
    } catch (error) {
        try { await connection.rollback(); } catch {}
        console.error('Permanent ticket deletion error:', error);
        return sendError(res, 'Server error', { statusCode: 500, errorCode: 'TICKET_DELETE_FAILED' });
    } finally {
        connection.release();
    }
};

// Correct an accidental paid status while retaining and voiding payment records.
exports.markTicketUnpaid = async (req, res) => {
    const connection = await db.getConnection();
    try {
        const id = Number(req.params.id);
        const reason = String(req.body?.reason || '').trim();
        if (!Number.isInteger(id) || id <= 0) {
            return sendError(res, 'Invalid ticket ID', { statusCode: 400, errorCode: 'VALIDATION_ERROR' });
        }
        if (reason.length < 5 || reason.length > 500) {
            return sendError(res, 'A correction reason between 5 and 500 characters is required', {
                statusCode: 400,
                errorCode: 'VALIDATION_ERROR'
            });
        }

        await connection.beginTransaction();
        const [rows] = await connection.query(
            'SELECT id, ticket_number, status FROM tickets WHERE id = ? FOR UPDATE',
            [id]
        );
        if (!rows.length) {
            await connection.rollback();
            return sendError(res, 'Ticket not found', { statusCode: 404, errorCode: 'TICKET_NOT_FOUND' });
        }
        const ticket = rows[0];
        if (ticket.status !== 'paid') {
            await connection.rollback();
            return sendError(res, 'Only paid tickets can be marked unpaid', {
                statusCode: 409,
                errorCode: 'TICKET_NOT_PAID'
            });
        }

        const [voidResult] = await connection.query(
            `UPDATE payments
             SET payment_status = 'voided',
                 notes = CONCAT(
                    COALESCE(notes, ''),
                    CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE '\n' END,
                    'Voided because paid status was corrected: ', ?
                 )
             WHERE ticket_id = ? AND payment_status <> 'voided'`,
            [reason, id]
        );
        await connection.query("UPDATE tickets SET status = 'unpaid' WHERE id = ?", [id]);
        await insertStatusHistorySafe({
            ticketId: id,
            previousStatus: 'paid',
            newStatus: 'unpaid',
            changedBy: req.user.id,
            reason,
            approverId: req.user.id,
            executor: connection
        });
        await connection.commit();

        try {
            await logAudit({
                userId: req.user.id,
                action: 'TICKET_MARKED_UNPAID',
                entityType: 'tickets',
                entityId: id,
                metadata: {
                    ticketNumber: ticket.ticket_number,
                    voidedPayments: Number(voidResult.affectedRows || 0),
                    reason
                },
                req
            });
        } catch (auditError) {
            console.error('Mark-unpaid audit error:', auditError);
        }

        return sendSuccess(res, 'Ticket marked unpaid successfully', {
            id,
            ticketNumber: ticket.ticket_number,
            status: 'unpaid',
            voidedPayments: Number(voidResult.affectedRows || 0)
        });
    } catch (error) {
        try { await connection.rollback(); } catch {}
        console.error('Mark ticket unpaid error:', error);
        return sendError(res, 'Server error', { statusCode: 500, errorCode: 'TICKET_MARK_UNPAID_FAILED' });
    } finally {
        connection.release();
    }
};

// Get dashboard statistics
exports.getDashboardStats = async (req, res) => {
    try {
        let userId = null;

        // Officers only see their own statistics.
        if (req.user.role === 'apprehending_officer') {
            userId = req.user.id;
        }

        // Total tickets
        let totalQuery = 'SELECT COUNT(*) as total FROM tickets';
        let params = [];

        if (userId) {
            totalQuery += ' WHERE user_id = ?';
            params.push(userId);
        }

        const [totalResult] = await db.query(totalQuery, params);

        // Paid tickets
        let paidQuery = 'SELECT COUNT(*) as paid FROM tickets WHERE status = ?';
        let paidParams = ['paid'];

        if (userId) {
            paidQuery += ' AND user_id = ?';
            paidParams.push(userId);
        }

        const [paidResult] = await db.query(paidQuery, paidParams);

        // Unpaid tickets
        let unpaidQuery = 'SELECT COUNT(*) as unpaid FROM tickets WHERE status = ?';
        let unpaidParams = ['unpaid'];

        if (userId) {
            unpaidQuery += ' AND user_id = ?';
            unpaidParams.push(userId);
        }

        const [unpaidResult] = await db.query(unpaidQuery, unpaidParams);

        // Repeat-offender case: this vehicle had an earlier non-cancelled ticket.
        let repeatQuery = `
            SELECT COUNT(*) AS repeat_offenders
            FROM tickets t
            WHERE t.status <> 'cancelled'
              AND EXISTS (
                  SELECT 1
                  FROM tickets previous
                  WHERE previous.vehicle_id = t.vehicle_id
                    AND previous.status <> 'cancelled'
                    AND (
                        previous.date_issued < t.date_issued
                        OR (previous.date_issued = t.date_issued AND previous.id < t.id)
                    )
              )
        `;
        const repeatParams = [];
        if (userId) {
            repeatQuery += ' AND t.user_id = ?';
            repeatParams.push(userId);
        }
        const [repeatResult] = await db.query(repeatQuery, repeatParams);

        // Revenue is based on actual non-voided payment records, not ticket face value.
        let revenueQuery = `
            SELECT COALESCE(SUM(p.amount_paid), 0) AS revenue
            FROM payments p
            JOIN tickets t ON p.ticket_id = t.id
            WHERE p.payment_status <> 'voided'
        `;
        const revenueParams = [];

        if (userId) {
            revenueQuery += ' AND t.user_id = ?';
            revenueParams.push(userId);
        }

        const [revenueResult] = await db.query(revenueQuery, revenueParams);

        return sendSuccess(res, 'Dashboard stats fetched successfully', {
            total: totalResult[0].total,
            paid: paidResult[0].paid,
            unpaid: unpaidResult[0].unpaid,
            repeatOffenders: repeatResult[0].repeat_offenders || 0,
            revenue: revenueResult[0].revenue || 0
        }, {
            legacy: {
                stats: {
                    total: totalResult[0].total,
                    paid: paidResult[0].paid,
                    unpaid: unpaidResult[0].unpaid,
                    repeatOffenders: repeatResult[0].repeat_offenders || 0,
                    revenue: revenueResult[0].revenue || 0
                }
            }
        });

    } catch (error) {
        console.error('Get stats error:', error);
        return sendError(res, 'Server error', {
            statusCode: 500,
            errorCode: 'STATS_FETCH_FAILED'
        });
    }
};

// Search tickets
exports.searchTickets = async (req, res) => {
    try {
        const { search } = req.query;

        if (!search) {
            return sendError(res, 'Search query is required', {
                statusCode: 400,
                errorCode: 'VALIDATION_ERROR'
            });
        }

        let query = `
            SELECT * FROM ticket_details
            WHERE (
                ticket_number LIKE ? OR plate_number LIKE ? OR owner_name LIKE ?
                OR owner_email LIKE ? OR violation_name LIKE ?
            )
        `;

        const searchTerm = `%${search}%`;
        let params = [searchTerm, searchTerm, searchTerm, searchTerm, searchTerm];

        // Apprehending officers only see tickets they issued.
        if (req.user.role === 'apprehending_officer') {
            query += ' AND user_id = ?';
            params.push(req.user.id);
        }


        query += ' ORDER BY date_issued DESC LIMIT 50';

        const [tickets] = await db.query(query, params);

        return sendSuccess(res, 'Tickets fetched successfully', tickets, {
            legacy: {
                tickets
            }
        });

    } catch (error) {
        console.error('Search tickets error:', error);
        return sendError(res, 'Server error', {
            statusCode: 500,
            errorCode: 'TICKETS_SEARCH_FAILED'
        });
    }
};
