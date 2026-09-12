const { rpc } = require('../config/supabase');
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

const validLifecycleStatuses = Object.keys(lifecycleToLegacyStatus);

const parsePositiveInt = (value, fallback) => {
    const parsed = parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

// Domain rejections are returned before any write by the atomic RPC.
const domainError = (res, result) => {
    if (!result.error) return false;
    sendError(res, result.error.message, result.error);
    return true;
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

        const result = await rpc('tvtms_ticket_list', { p_filters: {
            status: status ? lifecycleToLegacyStatus[status] || status : null,
            dateFrom, dateTo, enforcerId, violation, location, search,
            officerId: req.user.role === 'apprehending_officer' ? req.user.id : null,
            sortBy: normalizedSortBy, sortOrder: normalizedSortOrder,
            pageSize: safePageSize, offset
        } });
        const tickets = result.tickets;
        const total = Number(result.total || 0);
        const totalPages = Math.ceil(total / safePageSize) || 1;

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

        const detail = await rpc('tvtms_ticket_detail', { p_id: id });
        const tickets = detail ? [detail] : [];

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


        const timeline = tickets[0].timeline || [];

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

        const result = await rpc('tvtms_ticket_create', { p_user_id: req.user.id, p_data: {
            plate_number: normalizedPlateNumber, vehicle_type: normalizedVehicleType,
            owner_name: normalizedOwnerName, owner_email: normalizedOwnerEmail,
            owner_address: normalizedOwnerAddress, driver_license_number: normalizedLicense,
            violation_id: violationId, location: normalizedLocation, remarks: normalizedRemarks
        } });
        if (domainError(res, result)) return;
        const newTicket = [result.ticket];
        const ticketResult = { insertId: result.ticket.id };
        const ticketNumber = result.ticket.ticket_number;
        const penaltyInfo = result.penaltyInfo;

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
        console.error('Create ticket error:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return sendError(res, 'A duplicate ticket or vehicle record was detected. Please retry.', {
                statusCode: 409, errorCode: 'DUPLICATE_RECORD'
            });
        }
        return sendError(res, 'Server error while issuing ticket', {
            statusCode: 500, errorCode: 'TICKET_CREATE_FAILED'
        });
    }
};

// Update ticket status
exports.updateTicketStatus = async (req, res) => {
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

        const result = await rpc('tvtms_ticket_mutate', {
            p_action: 'status', p_id: id, p_user_id: req.user.id, p_role: req.user.role,
            p_data: { status, reason }
        });
        if (domainError(res, result)) return;
        const currentLifecycleStatus = result.previousLifecycleStatus;
        const dbStatus = result.storedStatus;

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
        console.error('Update ticket error:', error);
        return sendError(res, 'Server error while updating ticket', {
            statusCode: 500, errorCode: 'TICKET_UPDATE_FAILED'
        });
    }
};

// Update editable ticket details
exports.updateTicketDetails = async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return sendError(res, 'Invalid ticket ID', { statusCode: 400, errorCode: 'VALIDATION_ERROR' });
        }

        const result = await rpc('tvtms_ticket_mutate', {
            p_action: 'details', p_id: id, p_user_id: req.user.id, p_role: req.user.role,
            p_data: {
                ...(typeof req.body.location === 'string' ? { location: req.body.location.trim() } : {}),
                ...(typeof req.body.remarks === 'string' ? { remarks: req.body.remarks.trim() } : {})
            }
        });
        if (domainError(res, result)) return;
        const current = result.previous;
        const normalizedLocation = result.location;
        const normalizedRemarks = result.remarks;

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
        console.error('Update ticket details error:', error);
        return sendError(res, 'Server error', { statusCode: 500, errorCode: 'TICKET_UPDATE_FAILED' });
    }
};

// Cancel ticket (admin only). Records are retained for accountability.
exports.deleteTicket = async (req, res) => {
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

        const result = await rpc('tvtms_ticket_mutate', {
            p_action: 'cancel', p_id: id, p_user_id: req.user.id, p_role: req.user.role,
            p_data: { reason }
        });
        if (domainError(res, result)) return;
        const ticket = result.ticket;

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
        console.error('Cancel ticket error:', error);
        return sendError(res, 'Server error', { statusCode: 500, errorCode: 'TICKET_CANCEL_FAILED' });
    }
};

// Permanently delete an unpaid/cancelled ticket with no linked official records (admin only).
exports.permanentlyDeleteTicket = async (req, res) => {
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

        const result = await rpc('tvtms_ticket_mutate', {
            p_action: 'delete', p_id: id, p_user_id: req.user.id, p_role: req.user.role,
            p_data: { reason }
        });
        if (domainError(res, result)) return;
        const ticket = result.ticket;

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
        console.error('Permanent ticket deletion error:', error);
        return sendError(res, 'Server error', { statusCode: 500, errorCode: 'TICKET_DELETE_FAILED' });
    }
};

// Correct an accidental paid status while retaining and voiding payment records.
exports.markTicketUnpaid = async (req, res) => {
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

        const result = await rpc('tvtms_ticket_mutate', {
            p_action: 'unpaid', p_id: id, p_user_id: req.user.id, p_role: req.user.role,
            p_data: { reason }
        });
        if (domainError(res, result)) return;
        const ticket = result.ticket;
        const voidResult = { affectedRows: result.voidedPayments };

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
        console.error('Mark ticket unpaid error:', error);
        return sendError(res, 'Server error', { statusCode: 500, errorCode: 'TICKET_MARK_UNPAID_FAILED' });
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

        const stats = await rpc('tvtms_ticket_stats', { p_user_id: userId });
        return sendSuccess(res, 'Dashboard stats fetched successfully', stats, { legacy: { stats } });

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

        const result = await rpc('tvtms_ticket_list', { p_filters: {
            search, officerId: req.user.role === 'apprehending_officer' ? req.user.id : null,
            sortBy: 'date_issued', sortOrder: 'DESC', pageSize: 50, offset: 0
        } });
        const tickets = result.tickets;

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
