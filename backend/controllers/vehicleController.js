const db = require('../config/database');
const { sendSuccess, sendError } = require('../utils/apiResponse');

// License Plate Lookup
exports.lookupByPlate = async (req, res) => {
    try {
        const { plate_number } = req.query;

        if (!plate_number) {
            return sendError(res, 'plate_number is required', {
                statusCode: 400,
                errorCode: 'VALIDATION_ERROR'
            });
        }

        const normalizedPlate = String(plate_number).trim().toUpperCase().replace(/[\s-]+/g, '');

        // Get vehicle info
        const [vehicles] = await db.query(
            `SELECT id, plate_number, vehicle_type, owner_name, owner_email, owner_address, driver_license_number
             FROM vehicles
             WHERE REPLACE(REPLACE(UPPER(plate_number), '-', ''), ' ', '') = ?
             LIMIT 1`,
            [normalizedPlate]
        );

        if (vehicles.length === 0) {
            return sendError(res, 'Vehicle not found', {
                statusCode: 404,
                errorCode: 'VEHICLE_NOT_FOUND'
            });
        }

        const vehicle = vehicles[0];

        // Get all violations for this vehicle
        const [violations] = await db.query(
            `SELECT 
                t.id,
                t.ticket_number,
                t.date_issued,
                t.location,
                t.status,
                COALESCE(t.penalty_amount_at_issue, v.penalty_amount) AS penalty_amount,
                COALESCE((SELECT SUM(p.amount_paid) FROM payments p
                          WHERE p.ticket_id = t.id AND p.payment_status <> 'voided'), 0) AS total_paid,
                GREATEST(COALESCE(t.penalty_amount_at_issue, v.penalty_amount) -
                         COALESCE((SELECT SUM(p.amount_paid) FROM payments p
                                   WHERE p.ticket_id = t.id AND p.payment_status <> 'voided'), 0), 0) AS remaining_balance,
                v.violation_name,
                v.violation_code,
                v.demerit_points
             FROM tickets t
             LEFT JOIN violations v ON t.violation_id = v.id
             WHERE t.vehicle_id = ?
             ORDER BY t.date_issued DESC`,
            [vehicle.id]
        );

        res.json({
            success: true,
            vehicle: {
                id: vehicle.id,
                plate_number: vehicle.plate_number,
                vehicle_type: vehicle.vehicle_type,
                owner_name: vehicle.owner_name,
                owner_email: vehicle.owner_email,
                owner_address: vehicle.owner_address,
                status: 'active',
                registered_date: null
            },
            violations: violations || []
        });

    } catch (error) {
        console.error('Vehicle lookup error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// Get vehicle by ID
exports.getVehicleById = async (req, res) => {
    try {
        const { id } = req.params;

        const [vehicles] = await db.query(
            `SELECT id, plate_number, vehicle_type, owner_name, owner_email, owner_address, driver_license_number
             FROM vehicles
             WHERE id = ?
             LIMIT 1`,
            [id]
        );

        if (vehicles.length === 0) {
            return sendError(res, 'Vehicle not found', {
                statusCode: 404,
                errorCode: 'VEHICLE_NOT_FOUND'
            });
        }

        res.json({
            success: true,
            vehicle: {
                ...vehicles[0],
                status: 'active',
                registered_date: null
            }
        });

    } catch (error) {
        console.error('Get vehicle error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// Get all vehicles
exports.getAllVehicles = async (req, res) => {
    try {
        const { status = 'all' } = req.query;
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
        const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

        let query = 'SELECT id, plate_number, vehicle_type, owner_name, owner_email FROM vehicles';
        let params = [];

        if (status !== 'all') {
            query += ' WHERE 1 = 1';
        }

        query += ' ORDER BY plate_number ASC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const [vehicles] = await db.query(query, params);

        res.json({
            success: true,
            vehicles: (vehicles || []).map(v => ({
                ...v,
                status: 'active'
            })),
            limit,
            offset
        });

    } catch (error) {
        console.error('Get vehicles error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// Search vehicles
exports.searchVehicles = async (req, res) => {
    try {
        // Supports: ?query=   ?owner_name=   ?license_number=  (Panel: Repeat Offender search)
        const { query, owner_name, license_number, type = 'all' } = req.query;

        let sqlQuery, params;

        if (license_number) {
            // Search by driver's license number (panel requirement)
            sqlQuery = `
                SELECT v.id, v.plate_number, v.vehicle_type, v.owner_name, v.owner_email,
                       v.driver_license_number,
                       COUNT(t.id) AS violation_count
                FROM vehicles v
                LEFT JOIN tickets t ON t.vehicle_id = v.id
                WHERE v.driver_license_number = ?
                GROUP BY v.id
                ORDER BY v.plate_number ASC LIMIT 20
            `;
            params = [license_number.toUpperCase()];

        } else if (owner_name) {
            // Search by owner name (panel requirement)
            if (owner_name.trim().length < 2) {
                return res.status(400).json({ success: false, message: 'Name must be at least 2 characters' });
            }
            const nameTerm = `%${owner_name}%`;
            sqlQuery = `
                SELECT v.id, v.plate_number, v.vehicle_type, v.owner_name, v.owner_email,
                       v.driver_license_number,
                       COUNT(t.id) AS violation_count
                FROM vehicles v
                LEFT JOIN tickets t ON t.vehicle_id = v.id
                WHERE v.owner_name LIKE ?
                GROUP BY v.id
                ORDER BY v.owner_name ASC LIMIT 20
            `;
            params = [nameTerm];

        } else if (query) {
            // General search: plate, name, or email
            if (query.trim().length < 2) {
                return res.status(400).json({ success: false, message: 'Search query must be at least 2 characters' });
            }
            const searchTerm = `%${query}%`;
            sqlQuery = `
                SELECT v.id, v.plate_number, v.vehicle_type, v.owner_name, v.owner_email,
                       v.driver_license_number,
                       COUNT(t.id) AS violation_count
                FROM vehicles v
                LEFT JOIN tickets t ON t.vehicle_id = v.id
                WHERE (UPPER(v.plate_number) LIKE ? OR v.owner_name LIKE ? OR v.owner_email LIKE ?)
                GROUP BY v.id
                ORDER BY v.plate_number ASC LIMIT 20
            `;
            params = [searchTerm.toUpperCase(), searchTerm, searchTerm];
        } else {
            return res.status(400).json({ success: false, message: 'Provide query, owner_name, or license_number parameter' });
        }

        if (type !== 'all' && !license_number) {
            sqlQuery = sqlQuery.replace('GROUP BY v.id', `AND v.vehicle_type = ? GROUP BY v.id`);
            params.push(type);
        }

        const [vehicles] = await db.query(sqlQuery, params);

        res.json({
            success: true,
            vehicles: (vehicles || []).map(v => ({
                ...v,
                status: 'active',
                violation_count: parseInt(v.violation_count) || 0,
                is_repeat_offender: parseInt(v.violation_count) >= 2
            })),
            count: vehicles.length
        });

    } catch (error) {
        console.error('Search vehicles error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Get vehicle violation statistics
exports.getVehicleStats = async (req, res) => {
    try {
        const { plate_number } = req.query;

        if (!plate_number) {
            return sendError(res, 'plate_number is required', {
                statusCode: 400,
                errorCode: 'VALIDATION_ERROR'
            });
        }

        const normalizedPlate = String(plate_number).trim().toUpperCase().replace(/[\s-]+/g, '');

        // Get vehicle
        const [vehicles] = await db.query(
            `SELECT id FROM vehicles WHERE REPLACE(REPLACE(UPPER(plate_number), '-', ''), ' ', '') = ? LIMIT 1`,
            [normalizedPlate]
        );

        if (vehicles.length === 0) {
            return sendError(res, 'Vehicle not found', {
                statusCode: 404,
                errorCode: 'VEHICLE_NOT_FOUND'
            });
        }

        // Get statistics
        const [stats] = await db.query(
            `SELECT
                COUNT(*) AS total_violations,
                SUM(t.status = 'paid') AS paid_count,
                SUM(t.status = 'unpaid') AS unpaid_count,
                SUM(t.status = 'cancelled') AS cancelled_count,
                SUM(EXISTS(
                    SELECT 1 FROM disputes d
                    WHERE d.ticket_id = t.id AND d.status IN ('submitted', 'under_review')
                )) AS disputed_count,
                SUM(CASE WHEN t.status = 'unpaid' THEN GREATEST(
                    COALESCE(t.penalty_amount_at_issue, v.penalty_amount) -
                    COALESCE((SELECT SUM(p.amount_paid) FROM payments p
                              WHERE p.ticket_id = t.id AND p.payment_status <> 'voided'), 0),
                    0
                ) ELSE 0 END) AS outstanding_balance
             FROM tickets t
             JOIN violations v ON t.violation_id = v.id
             WHERE t.vehicle_id = ?`,
            [vehicles[0].id]
        );

        res.json({
            success: true,
            stats: {
                total_violations: stats[0].total_violations || 0,
                paid_count: stats[0].paid_count || 0,
                unpaid_count: stats[0].unpaid_count || 0,
                cancelled_count: stats[0].cancelled_count || 0,
                disputed_count: stats[0].disputed_count || 0,
                outstanding_balance: parseFloat(stats[0].outstanding_balance || 0)
            }
        });

    } catch (error) {
        console.error('Vehicle stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};
