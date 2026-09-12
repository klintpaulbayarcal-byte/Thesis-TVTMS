const { supabase, run, rpc } = require('../config/supabase');
const { sendError } = require('../utils/apiResponse');

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
        const vehicles = await rpc('tvtms_catalog_vehicle_by_plate', { p_plate: normalizedPlate });

        if (vehicles.length === 0) {
            return sendError(res, 'Vehicle not found', {
                statusCode: 404,
                errorCode: 'VEHICLE_NOT_FOUND'
            });
        }

        const vehicle = vehicles[0];

        // Get all violations for this vehicle
        const violations = await rpc('tvtms_catalog_vehicle_violations', { p_id: vehicle.id });

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

        const vehicles = await run(supabase.from('vehicles').select('id,plate_number,vehicle_type,owner_name,owner_email,owner_address,driver_license_number').eq('id', id).limit(1));

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
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
        const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

        const vehicles = await run(supabase.from('vehicles').select('id,plate_number,vehicle_type,owner_name,owner_email').order('plate_number').range(offset, offset + limit - 1));

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

        if (!license_number && !owner_name && !query) {
            return res.status(400).json({ success: false, message: 'Provide query, owner_name, or license_number parameter' });
        }
        if (!license_number && String(owner_name || query).trim().length < 2) {
            return res.status(400).json({ success: false, message: owner_name ? 'Name must be at least 2 characters' : 'Search query must be at least 2 characters' });
        }
        const vehicles = await rpc('tvtms_catalog_search_vehicles', {
            p_license: license_number ? String(license_number).toUpperCase() : null,
            p_owner: owner_name || null, p_query: query || null, p_type: type
        });

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
        const vehicles = await rpc('tvtms_catalog_vehicle_by_plate', { p_plate: normalizedPlate });

        if (vehicles.length === 0) {
            return sendError(res, 'Vehicle not found', {
                statusCode: 404,
                errorCode: 'VEHICLE_NOT_FOUND'
            });
        }

        // Get statistics
        const stats = [await rpc('tvtms_catalog_vehicle_stats', { p_id: vehicles[0].id })];

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
