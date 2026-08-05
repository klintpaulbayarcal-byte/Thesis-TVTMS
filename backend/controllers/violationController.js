const db = require('../config/database');
const { logAudit } = require('../utils/auditLogger');

// Get all violations
exports.getAllViolations = async (req, res) => {
    try {
        const [violations] = await db.query(
            'SELECT * FROM violations ORDER BY violation_code ASC'
        );

        res.json({
            success: true,
            violations
        });

    } catch (error) {
        console.error('Get violations error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
};

// Get active violations only
exports.getActiveViolations = async (req, res) => {
    try {
        const [violations] = await db.query(
            'SELECT * FROM violations WHERE status = ? ORDER BY violation_name ASC',
            ['active']
        );

        res.json({
            success: true,
            violations
        });

    } catch (error) {
        console.error('Get active violations error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
};

// Get violation by ID
exports.getViolationById = async (req, res) => {
    try {
        const { id } = req.params;

        const [violations] = await db.query(
            'SELECT * FROM violations WHERE id = ?',
            [id]
        );

        if (violations.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Violation not found' 
            });
        }

        res.json({
            success: true,
            violation: violations[0]
        });

    } catch (error) {
        console.error('Get violation error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
};

// Preview effective penalty by violation + plate number (repeat-offender aware)
exports.getPenaltyPreview = async (req, res) => {
    try {
        const { id } = req.params;
        const { plateNumber } = req.query;
        const normalizedPlateNumber = String(plateNumber || '').trim().toUpperCase().replace(/[\s-]+/g, '');

        if (!normalizedPlateNumber) {
            return res.status(400).json({
                success: false,
                message: 'plateNumber is required'
            });
        }

        const [violations] = await db.query(
            'SELECT id, violation_code, violation_name, penalty_amount FROM violations WHERE id = ? LIMIT 1',
            [id]
        );

        if (violations.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Violation not found'
            });
        }

        const violation = violations[0];

        const [[history]] = await db.query(
            `SELECT COUNT(*) as prior_count
             FROM tickets t
             JOIN vehicles v ON t.vehicle_id = v.id
             WHERE t.violation_id = ?
               AND REPLACE(REPLACE(UPPER(v.plate_number), '-', ''), ' ', '') = ?
               AND t.status <> 'cancelled'`,
            [id, normalizedPlateNumber]
        );

        const nextOffenseCount = Number(history.prior_count || 0) + 1;
        const basePenalty = Number(violation.penalty_amount);
        let effectivePenalty = basePenalty;
        let usedEscalationRule = false;

        try {
            const [rules] = await db.query(
                `SELECT penalty_amount
                 FROM violation_penalty_rules
                 WHERE violation_id = ?
                   AND offense_count = ?
                   AND is_active = 1
                   AND effective_from <= CURDATE()
                   AND (effective_to IS NULL OR effective_to >= CURDATE())
                 ORDER BY effective_from DESC
                 LIMIT 1`,
                [id, nextOffenseCount]
            );

            if (rules.length > 0) {
                effectivePenalty = Number(rules[0].penalty_amount);
                usedEscalationRule = true;
            }
        } catch (ruleError) {
            if (!(ruleError && ruleError.code === 'ER_NO_SUCH_TABLE')) {
                throw ruleError;
            }
        }

        res.json({
            success: true,
            penalty: {
                violationId: Number(id),
                violationCode: violation.violation_code,
                violationName: violation.violation_name,
                plateNumber: normalizedPlateNumber,
                priorOffenseCount: Number(history.prior_count || 0),
                nextOffenseCount,
                basePenalty,
                effectivePenalty,
                usedEscalationRule
            }
        });
    } catch (error) {
        console.error('Penalty preview error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// Create new violation (Admin only)
exports.createViolation = async (req, res) => {
    try {
        const code = String(req.body.violation_code || '').trim().toUpperCase();
        const name = String(req.body.violation_name || '').trim();
        const description = String(req.body.description || '').trim();
        const penalty = Number(req.body.penalty_amount);
        const points = Number(req.body.demerit_points || 0);

        if (!/^[A-Z0-9_-]{2,20}$/.test(code) || !name || name.length > 150 || description.length > 4000 ||
            !Number.isFinite(penalty) || penalty <= 0 || penalty > 10000000 ||
            !Number.isInteger(points) || points < 0 || points > 100) {
            return res.status(400).json({
                success: false,
                message: 'Provide a valid code, name, positive penalty amount, and demerit points from 0 to 100.'
            });
        }

        const [existing] = await db.query('SELECT id FROM violations WHERE violation_code = ? LIMIT 1', [code]);
        if (existing.length) return res.status(409).json({ success: false, message: 'Violation code already exists' });

        const [result] = await db.query(
            `INSERT INTO violations (violation_code, violation_name, description, penalty_amount, demerit_points)
             VALUES (?, ?, ?, ?, ?)`,
            [code, name, description || null, penalty, points]
        );
        await logAudit({
            userId: req.user.id,
            action: 'VIOLATION_CREATED',
            entityType: 'violations',
            entityId: result.insertId,
            metadata: { violationCode: code, penaltyAmount: penalty, demeritPoints: points },
            req
        });
        return res.status(201).json({ success: true, message: 'Violation created successfully', violationId: result.insertId });
    } catch (error) {
        console.error('Create violation error:', error);
        if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'Violation code already exists' });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Update violation (Admin only)
exports.updateViolation = async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, message: 'Invalid violation ID' });

        const [rows] = await db.query('SELECT * FROM violations WHERE id = ? LIMIT 1', [id]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Violation not found' });
        const current = rows[0];

        const code = String(req.body.violation_code ?? current.violation_code).trim().toUpperCase();
        const name = String(req.body.violation_name ?? current.violation_name).trim();
        const description = String(req.body.description ?? current.description ?? '').trim();
        const penalty = Number(req.body.penalty_amount ?? current.penalty_amount);
        const points = Number(req.body.demerit_points ?? current.demerit_points ?? 0);
        const status = String(req.body.status ?? current.status).trim().toLowerCase();

        if (!/^[A-Z0-9_-]{2,20}$/.test(code) || !name || name.length > 150 || description.length > 4000 ||
            !Number.isFinite(penalty) || penalty <= 0 || penalty > 10000000 ||
            !Number.isInteger(points) || points < 0 || points > 100 || !['active', 'inactive'].includes(status)) {
            return res.status(400).json({ success: false, message: 'One or more violation fields are invalid.' });
        }

        await db.query(
            `UPDATE violations SET violation_code = ?, violation_name = ?, description = ?, penalty_amount = ?,
             demerit_points = ?, status = ? WHERE id = ?`,
            [code, name, description || null, penalty, points, status, id]
        );
        await logAudit({
            userId: req.user.id,
            action: 'VIOLATION_UPDATED',
            entityType: 'violations',
            entityId: id,
            metadata: { violationCode: code, penaltyAmount: penalty, demeritPoints: points, status },
            req
        });
        return res.json({ success: true, message: 'Violation updated successfully' });
    } catch (error) {
        console.error('Update violation error:', error);
        if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'Violation code already exists' });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Delete violation (Admin only)
exports.deleteViolation = async (req, res) => {
    try {
        const { id } = req.params;

        // Check if violation exists
        const [violations] = await db.query('SELECT id FROM violations WHERE id = ?', [id]);
        
        if (violations.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Violation not found' 
            });
        }

        // Prevent delete if violation is used in tickets
        const [ticketRefs] = await db.query(
            'SELECT COUNT(*) AS total FROM tickets WHERE violation_id = ?'
            , [id]
        );

        if (ticketRefs[0].total > 0) {
            return res.status(409).json({
                success: false,
                message: 'Cannot delete this violation because it is already used in existing tickets. Set it to inactive instead.'
            });
        }

        // Delete violation
        await db.query('DELETE FROM violations WHERE id = ?', [id]);
        await logAudit({
            userId: req.user.id,
            action: 'VIOLATION_DELETED',
            entityType: 'violations',
            entityId: Number(id),
            metadata: {},
            req
        });

        res.json({
            success: true,
            message: 'Violation deleted successfully'
        });

    } catch (error) {
        console.error('Delete violation error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
};
