const db = require('../config/database');
const PDFDocument = require('pdfkit');

const toDateString = date => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date).reduce((result, part) => {
        if (part.type !== 'literal') result[part.type] = part.value;
        return result;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
};

const normalizeDateRange = (query) => {
    const endDate = query.endDate || toDateString(new Date());
    const start = new Date(`${endDate}T00:00:00+08:00`);
    start.setDate(start.getDate() - 29);
    const startDate = query.startDate || toDateString(start);
    return { startDate, endDate };
};

const getCollectedRevenue = async (startDate, endDate) => {
    const [[row]] = await db.query(
        `SELECT COALESCE(SUM(amount_paid), 0) AS total
         FROM payments
         WHERE DATE(payment_date) BETWEEN ? AND ?
           AND payment_status <> 'voided'`,
        [startDate, endDate]
    );
    return Number(row?.total || 0);
};

const getMonthRange = (year, month) => {
    const safeYear = Number(year);
    const safeMonth = Number(month);
    const startDate = `${safeYear}-${String(safeMonth).padStart(2, '0')}-01`;
    const lastDay = new Date(Date.UTC(safeYear, safeMonth, 0)).getUTCDate();
    const endDate = `${safeYear}-${String(safeMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { startDate, endDate };
};

// Get daily report
exports.getDailyReport = async (req, res) => {
    try {
        const { date } = req.query;
        const targetDate = date || toDateString(new Date());

        const [tickets] = await db.query(
            'SELECT * FROM ticket_details WHERE date_issued = ? ORDER BY time_issued DESC',
            [targetDate]
        );
        const totalRevenue = await getCollectedRevenue(targetDate, targetDate);

        const stats = {
            total: tickets.length,
            paid: tickets.filter(t => t.status === 'paid').length,
            unpaid: tickets.filter(t => t.status === 'unpaid').length,
            cancelled: tickets.filter(t => t.status === 'cancelled').length,
            totalRevenue
        };

        res.json({ success: true, date: targetDate, stats, tickets });
    } catch (error) {
        console.error('Daily report error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Get monthly report
exports.getMonthlyReport = async (req, res) => {
    try {
        const { year, month } = req.query;
        const targetYear = Number(year || new Intl.DateTimeFormat('en', { timeZone: 'Asia/Manila', year: 'numeric' }).format(new Date()));
        const targetMonth = Number(month || new Intl.DateTimeFormat('en', { timeZone: 'Asia/Manila', month: 'numeric' }).format(new Date()));
        if (!Number.isInteger(targetYear) || !Number.isInteger(targetMonth) || targetMonth < 1 || targetMonth > 12) {
            return res.status(400).json({ success: false, message: 'Invalid year or month' });
        }

        const [tickets] = await db.query(
            `SELECT * FROM ticket_details
             WHERE YEAR(date_issued) = ? AND MONTH(date_issued) = ?
             ORDER BY date_issued DESC, time_issued DESC`,
            [targetYear, targetMonth]
        );

        const dailyStats = {};
        tickets.forEach(ticket => {
            const date = String(ticket.date_issued);
            if (!dailyStats[date]) dailyStats[date] = { total: 0, paid: 0, unpaid: 0, revenue: 0 };
            dailyStats[date].total += 1;
            if (ticket.status === 'paid') dailyStats[date].paid += 1;
            else if (ticket.status === 'unpaid') dailyStats[date].unpaid += 1;
        });

        const monthRange = getMonthRange(targetYear, targetMonth);
        const [dailyCollections] = await db.query(
            `SELECT DATE(payment_date) AS collection_date, COALESCE(SUM(amount_paid), 0) AS revenue
             FROM payments
             WHERE DATE(payment_date) BETWEEN ? AND ? AND payment_status <> 'voided'
             GROUP BY DATE(payment_date)`,
            [monthRange.startDate, monthRange.endDate]
        );
        dailyCollections.forEach(row => {
            const date = String(row.collection_date);
            if (!dailyStats[date]) dailyStats[date] = { total: 0, paid: 0, unpaid: 0, revenue: 0 };
            dailyStats[date].revenue = Number(row.revenue || 0);
        });

        const totalRevenue = await getCollectedRevenue(monthRange.startDate, monthRange.endDate);
        const stats = {
            total: tickets.length,
            paid: tickets.filter(t => t.status === 'paid').length,
            unpaid: tickets.filter(t => t.status === 'unpaid').length,
            cancelled: tickets.filter(t => t.status === 'cancelled').length,
            totalRevenue
        };

        res.json({ success: true, year: targetYear, month: targetMonth, stats, dailyStats, tickets });
    } catch (error) {
        console.error('Monthly report error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Get yearly report
exports.getYearlyReport = async (req, res) => {
    try {
        const { year } = req.query;
        const targetYear = Number(year || new Intl.DateTimeFormat('en', { timeZone: 'Asia/Manila', year: 'numeric' }).format(new Date()));
        if (!Number.isInteger(targetYear) || targetYear < 2000 || targetYear > 2200) {
            return res.status(400).json({ success: false, message: 'Invalid year' });
        }

        const [tickets] = await db.query(
            'SELECT * FROM ticket_details WHERE YEAR(date_issued) = ? ORDER BY date_issued DESC',
            [targetYear]
        );

        const monthlyStats = {};
        tickets.forEach(ticket => {
            const month = Number(String(ticket.date_issued).slice(5, 7));
            if (!monthlyStats[month]) monthlyStats[month] = { total: 0, paid: 0, unpaid: 0, revenue: 0 };
            monthlyStats[month].total += 1;
            if (ticket.status === 'paid') monthlyStats[month].paid += 1;
            else if (ticket.status === 'unpaid') monthlyStats[month].unpaid += 1;
        });

        const [monthlyCollections] = await db.query(
            `SELECT MONTH(payment_date) AS month_number, COALESCE(SUM(amount_paid), 0) AS revenue
             FROM payments
             WHERE YEAR(payment_date) = ? AND payment_status <> 'voided'
             GROUP BY MONTH(payment_date)`,
            [targetYear]
        );
        monthlyCollections.forEach(row => {
            const month = Number(row.month_number);
            if (!monthlyStats[month]) monthlyStats[month] = { total: 0, paid: 0, unpaid: 0, revenue: 0 };
            monthlyStats[month].revenue = Number(row.revenue || 0);
        });

        const totalRevenue = await getCollectedRevenue(`${targetYear}-01-01`, `${targetYear}-12-31`);
        const stats = {
            total: tickets.length,
            paid: tickets.filter(t => t.status === 'paid').length,
            unpaid: tickets.filter(t => t.status === 'unpaid').length,
            cancelled: tickets.filter(t => t.status === 'cancelled').length,
            totalRevenue
        };

        res.json({ success: true, year: targetYear, stats, monthlyStats, tickets });
    } catch (error) {
        console.error('Yearly report error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Get custom date range report
exports.getCustomReport = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const datePattern = /^\d{4}-\d{2}-\d{2}$/;
        if (!datePattern.test(startDate || '') || !datePattern.test(endDate || '')) {
            return res.status(400).json({ success: false, message: 'Valid startDate and endDate are required' });
        }
        if (startDate > endDate) {
            return res.status(400).json({ success: false, message: 'startDate cannot be later than endDate' });
        }

        const [tickets] = await db.query(
            `SELECT * FROM ticket_details
             WHERE date_issued BETWEEN ? AND ?
             ORDER BY date_issued DESC, time_issued DESC`,
            [startDate, endDate]
        );
        const totalRevenue = await getCollectedRevenue(startDate, endDate);
        const stats = {
            total: tickets.length,
            paid: tickets.filter(t => t.status === 'paid').length,
            unpaid: tickets.filter(t => t.status === 'unpaid').length,
            cancelled: tickets.filter(t => t.status === 'cancelled').length,
            totalRevenue
        };

        res.json({ success: true, startDate, endDate, stats, tickets });
    } catch (error) {
        console.error('Custom report error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Get violation statistics
exports.getViolationStats = async (req, res) => {
    try {
        const [stats] = await db.query(`
            SELECT 
                v.violation_name,
                v.violation_code,
                COUNT(t.id) as count,
                SUM(CASE WHEN t.status = 'paid' THEN 1 ELSE 0 END) as paid_count,
                COALESCE(SUM(p.total_paid), 0) as total_revenue
            FROM violations v
            LEFT JOIN tickets t ON v.id = t.violation_id
            LEFT JOIN (
                SELECT ticket_id, SUM(amount_paid) AS total_paid
                FROM payments
                WHERE payment_status <> 'voided'
                GROUP BY ticket_id
            ) p ON p.ticket_id = t.id
            GROUP BY v.id, v.violation_name, v.violation_code
            ORDER BY count DESC
        `);

        res.json({
            success: true,
            stats
        });

    } catch (error) {
        console.error('Violation stats error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
};

// Get Apprehending Officer performance for the selected reporting period.
exports.getOfficerPerformance = async (req, res) => {
    try {
        const { startDate, endDate } = normalizeDateRange(req.query);
        const [performance] = await db.query(`
            SELECT
                u.id,
                u.name,
                COUNT(t.id) AS total_tickets,
                SUM(CASE WHEN t.status = 'paid' THEN 1 ELSE 0 END) AS paid_tickets,
                SUM(CASE WHEN t.status = 'unpaid' THEN 1 ELSE 0 END) AS unpaid_tickets,
                COALESCE(SUM(p.total_paid), 0) AS total_revenue
            FROM users u
            LEFT JOIN tickets t
                ON u.id = t.user_id
               AND t.date_issued BETWEEN ? AND ?
            LEFT JOIN (
                SELECT ticket_id, SUM(amount_paid) AS total_paid
                FROM payments
                WHERE payment_status <> 'voided'
                GROUP BY ticket_id
            ) p ON p.ticket_id = t.id
            WHERE u.role = 'apprehending_officer'
              AND u.status = 'active'
            GROUP BY u.id, u.name
            ORDER BY total_tickets DESC, u.name ASC
        `, [startDate, endDate]);

        const productivity = performance.map(item => ({
            ...item,
            tickets_issued: Number(item.total_tickets || 0),
            paid_value: Number(item.total_revenue || 0)
        }));
        res.json({ success: true, startDate, endDate, performance, productivity });
    } catch (error) {
        console.error('Apprehending Officer performance error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.getCollectionsSummary = async (req, res) => {
    try {
        const { startDate, endDate } = normalizeDateRange(req.query);

        const [dailyCollections] = await db.query(
            `SELECT DATE(p.payment_date) as collection_date,
                    COUNT(*) as payment_count,
                    SUM(p.amount_paid) as total_collected
             FROM payments p
             WHERE DATE(p.payment_date) BETWEEN ? AND ?
               AND p.payment_status <> 'voided'
             GROUP BY DATE(p.payment_date)
             ORDER BY DATE(p.payment_date) DESC`,
            [startDate, endDate]
        );

        const [overall] = await db.query(
            `SELECT COALESCE(SUM(p.amount_paid), 0) as total_collected,
                    COUNT(*) as payment_count,
                    COUNT(DISTINCT p.ticket_id) as settled_tickets
             FROM payments p
             WHERE DATE(p.payment_date) BETWEEN ? AND ?
               AND p.payment_status <> 'voided'`,
            [startDate, endDate]
        );

        res.json({
            success: true,
            startDate,
            endDate,
            summary: overall[0],
            dailyCollections
        });
    } catch (error) {
        console.error('Collections summary error:', error);

        if (error.code === 'ER_NO_SUCH_TABLE') {
            return res.status(400).json({
                success: false,
                message: 'Payments table is out of date. Restart the server so auto-migration can update it.'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

exports.getViolationHotspots = async (req, res) => {
    try {
        const { startDate, endDate } = normalizeDateRange(req.query);

        const [hotspots] = await db.query(
            `SELECT
                COALESCE(NULLIF(TRIM(location), ''), 'Unspecified') as location,
                COUNT(*) as total_violations,
                SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_count,
                SUM(CASE WHEN status = 'unpaid' THEN 1 ELSE 0 END) as unpaid_count
             FROM tickets
             WHERE date_issued BETWEEN ? AND ?
             GROUP BY COALESCE(NULLIF(TRIM(location), ''), 'Unspecified')
             ORDER BY total_violations DESC
             LIMIT 20`,
            [startDate, endDate]
        );

        res.json({
            success: true,
            startDate,
            endDate,
            hotspots
        });
    } catch (error) {
        console.error('Hotspots report error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};


exports.exportReportPdf = async (req, res) => {
    try {
        const { type = 'daily', date, year, month, startDate, endDate } = req.query;

        let tickets = [];
        let title = 'Report';
        let reportStartDate;
        let reportEndDate;

        if (type === 'daily') {
            const targetDate = date || toDateString(new Date());
            [tickets] = await db.query(
                'SELECT * FROM ticket_details WHERE date_issued = ? ORDER BY time_issued DESC',
                [targetDate]
            );
            title = `Daily Report - ${targetDate}`;
            reportStartDate = targetDate;
            reportEndDate = targetDate;
        } else if (type === 'monthly') {
            const targetYear = year || new Date().getFullYear();
            const targetMonth = month || (new Date().getMonth() + 1);
            [tickets] = await db.query(
                `SELECT * FROM ticket_details
                 WHERE YEAR(date_issued) = ? AND MONTH(date_issued) = ?
                 ORDER BY date_issued DESC, time_issued DESC`,
                [targetYear, targetMonth]
            );
            title = `Monthly Report - ${targetYear}-${String(targetMonth).padStart(2, '0')}`;
            ({ startDate: reportStartDate, endDate: reportEndDate } = getMonthRange(targetYear, targetMonth));
        } else if (type === 'yearly') {
            const targetYear = year || new Date().getFullYear();
            [tickets] = await db.query(
                'SELECT * FROM ticket_details WHERE YEAR(date_issued) = ? ORDER BY date_issued DESC',
                [targetYear]
            );
            title = `Yearly Report - ${targetYear}`;
            reportStartDate = `${targetYear}-01-01`;
            reportEndDate = `${targetYear}-12-31`;
        } else if (type === 'custom') {
            if (!startDate || !endDate) {
                return res.status(400).json({
                    success: false,
                    message: 'startDate and endDate are required for custom report export'
                });
            }

            [tickets] = await db.query(
                `SELECT * FROM ticket_details
                 WHERE date_issued BETWEEN ? AND ?
                 ORDER BY date_issued DESC, time_issued DESC`,
                [startDate, endDate]
            );
            title = `Custom Report - ${startDate} to ${endDate}`;
            reportStartDate = startDate;
            reportEndDate = endDate;
        } else {
            return res.status(400).json({
                success: false,
                message: 'Invalid report type'
            });
        }

        const totalRevenue = await getCollectedRevenue(reportStartDate, reportEndDate);
        const [settingRows] = await db.query(
            `SELECT setting_key, setting_value FROM system_settings
             WHERE setting_key IN ('lgu_name','lgu_address','lgu_contact','system_title')`
        );
        const reportSettings = Object.fromEntries(settingRows.map(row => [row.setting_key, row.setting_value]));
        const systemTitle = reportSettings.system_title || 'Municipal Traffic Violation Ticketing and Management System';
        const lguName = reportSettings.lgu_name || 'Municipality of Calape';
        const lguAddress = reportSettings.lgu_address || 'Calape, Bohol';
        const lguContact = reportSettings.lgu_contact || '';
        const stats = {
            total: tickets.length,
            paid: tickets.filter(t => t.status === 'paid').length,
            unpaid: tickets.filter(t => t.status === 'unpaid').length,
            cancelled: tickets.filter(t => t.status === 'cancelled').length,
            totalRevenue
        };

        const filename = `${type}-report-${new Date().toISOString().slice(0, 10)}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        doc.pipe(res);

        doc.fontSize(16).text(systemTitle, { align: 'center' });
        doc.fontSize(12).text(`${lguName} — Traffic Enforcement Division`, { align: 'center' });
        doc.fontSize(9).text([lguAddress, lguContact].filter(Boolean).join(' | '), { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(12).text(title, { align: 'center' });
        doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
        doc.moveDown();

        doc.fontSize(11).text(`Total Tickets: ${stats.total}`);
        doc.text(`Paid Tickets: ${stats.paid}`);
        doc.text(`Unpaid Tickets: ${stats.unpaid}`);
        doc.text(`Cancelled Tickets: ${stats.cancelled}`);
        doc.text(`Total Revenue: PHP ${Number(stats.totalRevenue || 0).toFixed(2)}`);
        doc.moveDown();

        doc.fontSize(11).text('Ticket Details', { underline: true });
        doc.moveDown(0.5);

        if (tickets.length === 0) {
            doc.fontSize(10).text('No tickets found for the selected period.');
        } else {
            tickets.slice(0, 200).forEach((ticket, index) => {
                const line = `${index + 1}. ${ticket.ticket_number} | ${ticket.date_issued} | ${ticket.plate_number} | ${ticket.violation_name} | PHP ${Number(ticket.penalty_amount).toFixed(2)} | ${ticket.status}`;
                doc.fontSize(9).text(line, { width: 520 });

                if (doc.y > 760) {
                    doc.addPage();
                }
            });
        }

        doc.end();
    } catch (error) {
        console.error('Export PDF error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// Analytics Dashboard Endpoints

// Get collections data for charts
exports.getCollectionsChart = async (req, res) => {
    try {
        const { startDate, endDate } = normalizeDateRange(req.query);

        const [dailyData] = await db.query(
            `SELECT DATE(p.payment_date) as date,
                    SUM(p.amount_paid) as amount
             FROM payments p
             WHERE DATE(p.payment_date) BETWEEN ? AND ?
               AND p.payment_status <> 'voided'
             GROUP BY DATE(p.payment_date)
             ORDER BY DATE(p.payment_date)`,
            [startDate, endDate]
        );

        const [total] = await db.query(
            `SELECT COALESCE(SUM(p.amount_paid), 0) as totalAmount,
                    COUNT(*) as paymentCount
             FROM payments p
             WHERE DATE(p.payment_date) BETWEEN ? AND ?
               AND p.payment_status <> 'voided'`,
            [startDate, endDate]
        );

        res.json({
            success: true,
            data: {
                dailyData: dailyData || [],
                totalAmount: total[0]?.totalAmount || 0,
                paymentCount: total[0]?.paymentCount || 0
            }
        });
    } catch (error) {
        console.error('Collections chart error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Get payment status breakdown
exports.getPaymentStatus = async (req, res) => {
    try {
        const { startDate, endDate } = normalizeDateRange(req.query);

        const [breakdown] = await db.query(
            `SELECT 
                t.status,
                COUNT(*) as count,
                COALESCE(SUM(CASE WHEN t.status = 'paid' THEN COALESCE(t.penalty_amount_at_issue, v.penalty_amount) ELSE COALESCE(t.penalty_amount_at_issue, v.penalty_amount) END), 0) as amount
             FROM tickets t
             LEFT JOIN violations v ON t.violation_id = v.id
             WHERE t.date_issued BETWEEN ? AND ?
             GROUP BY t.status`,
            [startDate, endDate]
        );

        const [[openDisputes]] = await db.query(
            `SELECT COUNT(DISTINCT d.ticket_id) AS disputed
             FROM disputes d
             JOIN tickets t ON d.ticket_id = t.id
             WHERE t.date_issued BETWEEN ? AND ?
               AND d.status IN ('submitted', 'under_review')`,
            [startDate, endDate]
        );

        const result = {
            paid: 0,
            unpaid: 0,
            disputed: Number(openDisputes?.disputed || 0),
            cancelled: 0
        };

        breakdown.forEach(item => {
            if (item.status === 'paid') result.paid = Number(item.count || 0);
            else if (item.status === 'unpaid') result.unpaid = Number(item.count || 0);
            else if (item.status === 'cancelled') result.cancelled = Number(item.count || 0);
        });

        res.json({
            success: true,
            data: {
                breakdown: result,
                unpaidTotal: breakdown.find(b => b.status === 'unpaid')?.amount || 0,
                unpaidCount: result.unpaid
            }
        });
    } catch (error) {
        console.error('Payment status error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Get tickets summary
exports.getTicketsSummary = async (req, res) => {
    try {
        const { startDate, endDate } = normalizeDateRange(req.query);

        const [total] = await db.query(
            `SELECT COUNT(*) as totalIssued,
                    SUM(CASE WHEN status = 'unpaid' THEN 1 ELSE 0 END) as pendingPayment
             FROM tickets
             WHERE date_issued BETWEEN ? AND ?`,
            [startDate, endDate]
        );

        const [topViolations] = await db.query(
            `SELECT v.violation_name, COUNT(*) as count
             FROM tickets t
             LEFT JOIN violations v ON t.violation_id = v.id
             WHERE t.date_issued BETWEEN ? AND ?
             GROUP BY v.id, v.violation_name
             ORDER BY count DESC
             LIMIT 10`,
            [startDate, endDate]
        );

        res.json({
            success: true,
            data: {
                totalIssued: total[0]?.totalIssued || 0,
                pendingPayment: total[0]?.pendingPayment || 0,
                topViolations: topViolations || []
            }
        });
    } catch (error) {
        console.error('Tickets summary error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Get dispute rate
exports.getDisputeRate = async (req, res) => {
    try {
        const { startDate, endDate } = normalizeDateRange(req.query);

        const [disputes] = await db.query(
            `SELECT COUNT(*) as totalDisputes,
                    SUM(CASE WHEN status IN ('approved', 'rejected', 'closed') THEN 1 ELSE 0 END) as resolvedCount
             FROM disputes
             WHERE DATE(created_at) BETWEEN ? AND ?`,
            [startDate, endDate]
        );

        const resolutionRate = disputes[0]?.totalDisputes > 0 
            ? Math.round((disputes[0]?.resolvedCount / disputes[0]?.totalDisputes) * 100)
            : 0;

        res.json({
            success: true,
            data: {
                resolutionRate,
                resolvedCount: disputes[0]?.resolvedCount || 0,
                totalDisputes: disputes[0]?.totalDisputes || 0
            }
        });
    } catch (error) {
        console.error('Dispute rate error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Get monthly revenue data
exports.getMonthlyRevenue = async (req, res) => {
    try {
        const [monthlyData] = await db.query(
            `SELECT DATE_FORMAT(p.payment_date, '%Y-%m') as month,
                    SUM(p.amount_paid) as totalAmount
             FROM payments p
             WHERE p.payment_status <> 'voided'
             GROUP BY DATE_FORMAT(p.payment_date, '%Y-%m')
             ORDER BY month DESC
             LIMIT 12`
        );

        const sorted = (monthlyData || [])
            .sort((a, b) => a.month.localeCompare(b.month))
            .map(item => ({
                month: item.month,
                totalAmount: item.totalAmount || 0
            }));

        res.json({
            success: true,
            data: sorted
        });
    } catch (error) {
        console.error('Monthly revenue error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Apprehending Officer performance report (admin only)
exports.officerPerformance = async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT
                u.id,
                u.name AS officer_name,
                u.contact_number,
                COUNT(t.id) AS total_tickets,
                SUM(CASE WHEN t.status = 'paid' THEN 1 ELSE 0 END) AS paid_tickets,
                SUM(CASE WHEN t.status = 'unpaid' THEN 1 ELSE 0 END) AS unpaid_tickets,
                SUM(CASE WHEN t.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_tickets,
                ROUND(
                    100.0 * SUM(CASE WHEN t.status = 'paid' THEN 1 ELSE 0 END) /
                    NULLIF(COUNT(CASE WHEN t.status != 'cancelled' THEN 1 END), 0),
                2) AS collection_rate_pct,
                SUM(COALESCE(t.penalty_amount_at_issue, viol.penalty_amount)) AS total_value,
                MIN(t.date_issued) AS first_ticket_date,
                MAX(t.date_issued) AS latest_ticket_date
            FROM users u
            LEFT JOIN tickets t ON t.user_id = u.id
            LEFT JOIN violations viol ON t.violation_id = viol.id
            WHERE u.role = 'apprehending_officer' AND u.status = 'active'
            GROUP BY u.id, u.name, u.contact_number
            ORDER BY total_tickets DESC
        `);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Apprehending Officer performance error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Delinquent account aging report (admin only)
exports.agingReport = async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT
                v.plate_number,
                v.vehicle_type,
                v.owner_name,
                v.owner_email,
                COUNT(t.id) AS unpaid_tickets,
                SUM(COALESCE(t.penalty_amount_at_issue, viol.penalty_amount)) AS total_due,
                MIN(t.date_issued) AS oldest_unpaid_date,
                DATEDIFF(CURDATE(), MIN(t.date_issued)) AS days_overdue,
                CASE
                    WHEN DATEDIFF(CURDATE(), MIN(t.date_issued)) <= 30 THEN '0-30 days'
                    WHEN DATEDIFF(CURDATE(), MIN(t.date_issued)) <= 60 THEN '31-60 days'
                    ELSE '60+ days (critical)'
                END AS aging_bucket
            FROM tickets t
            JOIN vehicles v ON t.vehicle_id = v.id
            JOIN violations viol ON t.violation_id = viol.id
            WHERE t.status = 'unpaid'
            GROUP BY v.plate_number, v.vehicle_type, v.owner_name, v.owner_email
            ORDER BY days_overdue DESC
        `);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Aging report error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Barangay / location-level report
exports.barangayReport = async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT
                TRIM(SUBSTRING_INDEX(LOWER(t.location), ',', -1)) AS barangay,
                COUNT(*) AS total_tickets,
                SUM(CASE WHEN t.status = 'paid' THEN 1 ELSE 0 END) AS paid,
                SUM(CASE WHEN t.status = 'unpaid' THEN 1 ELSE 0 END) AS unpaid,
                SUM(COALESCE(t.penalty_amount_at_issue, viol.penalty_amount)) AS total_value,
                GROUP_CONCAT(DISTINCT viol.violation_name ORDER BY viol.violation_name SEPARATOR ', ') AS top_violations
            FROM tickets t
            JOIN violations viol ON t.violation_id = viol.id
            WHERE t.location IS NOT NULL AND t.location != ''
            GROUP BY barangay
            ORDER BY total_tickets DESC
            LIMIT 30
        `);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Barangay report error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};
