// ==============================================
// Dashboard Functions
// ==============================================

const isDashboardPage = () => {
    const path = (window.location.pathname || '').toLowerCase();
    return path.endsWith('/admin-dashboard.html') || path.endsWith('/officer-dashboard.html');
};

const extractBarangayName = (location) => {
    if (!location) return 'Unspecified';
    const cleaned = String(location).trim();
    const firstPart = cleaned.split(',')[0].trim();
    return firstPart || 'Unspecified';
};

const getRiskClass = (index, total) => {
    if (index === 0 || index === 1) return 'risk-high';
    if (index === 2 || index === 3) return 'risk-medium';
    if (index >= 4 || total <= 3) return 'risk-low';
    return 'risk-low';
};

const withTimeout = (promise, ms, timeoutMessage) => {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
    });

    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

const renderBarangayRiskLevels = async () => {
    const skyline = document.getElementById('barangayRiskSkyline');
    const summary = document.getElementById('barangayRiskSummary');

    if (!skyline || !summary) return;

    try {
        const endDate = new Date().toISOString().split('T')[0];
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 29);

        const response = await withTimeout(
            API.getHotspotsReport(startDate.toISOString().split('T')[0], endDate),
            10000,
            'Hotspots request timed out'
        );
        const hotspots = Array.isArray(response.hotspots) ? response.hotspots : [];
        const ranked = hotspots
            .map((item) => ({
                name: extractBarangayName(item.location),
                total: Number(item.total_violations) || 0,
                paid: Number(item.paid_count) || 0,
                unpaid: Number(item.unpaid_count) || 0
            }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 5);

        if (ranked.length === 0) {
            skyline.innerHTML = '<div class="risk-loading-state"><p>No barangay violation data available.</p></div>';
            summary.textContent = 'No barangay data available for the selected period.';
            return;
        }

        const maxTotal = Math.max(...ranked.map((item) => item.total), 1);

        skyline.innerHTML = ranked.map((item, index) => {
            const heightPercent = Math.max(24, Math.round((item.total / maxTotal) * 100));
            const riskClass = getRiskClass(index, ranked.length);
            const label = item.total === ranked[0].total ? 'Most violations' : item.total >= ranked[1]?.total ? 'High risk' : 'Watch list';

            return `
                <div class="risk-column ${riskClass}" style="height: ${heightPercent}%" title="${escapeHtmlText(item.name)}: ${item.total} violations">
                    <span class="risk-value">${item.total}</span>
                    <small>${escapeHtmlText(item.name)}</small>
                    <em>${label}</em>
                </div>
            `;
        }).join('');

        summary.textContent = `Most violations: ${ranked[0].name} (${ranked[0].total} tickets in the last 30 days)`;
    } catch (error) {
        console.error('Failed to load barangay risk levels:', error);
        skyline.innerHTML = '<div class="risk-loading-state"><p>Failed to load barangay risk levels.</p></div>';
        summary.textContent = 'Unable to load barangay risk data right now.';
    }
};

// Load dashboard statistics
const loadDashboardStats = async () => {
    const totalTicketsEl = document.getElementById('totalTickets');
    const paidTicketsEl = document.getElementById('paidTickets');
    const unpaidTicketsEl = document.getElementById('unpaidTickets');
    const totalRevenueEl = document.getElementById('totalRevenue');
    const repeatOffendersEl = document.getElementById('repeatOffenders');

    // Admin renders revenue while the Officer dashboard renders repeat-offender cases.
    if (!totalTicketsEl || !paidTicketsEl || !unpaidTicketsEl || (!totalRevenueEl && !repeatOffendersEl)) {
        return;
    }

    try {
        const data = await API.getDashboardStats();
        const stats = data?.stats || data?.data || {};

        if (data.success) {
            totalTicketsEl.textContent = stats.total || 0;
            paidTicketsEl.textContent = stats.paid || 0;
            unpaidTicketsEl.textContent = stats.unpaid || 0;
            if (totalRevenueEl) totalRevenueEl.textContent = formatCurrency(stats.revenue);
            if (repeatOffendersEl) repeatOffendersEl.textContent = Number(stats.repeatOffenders || 0);
        }
    } catch (error) {
        console.error('Error loading stats:', error);
        if (isDashboardPage()) {
            showAlert('Failed to load dashboard statistics', 'danger');
        }
    }
};

// Load recent tickets
const loadRecentTickets = async (limit = 10) => {
    const tbody = document.getElementById('recentTicketsBody');
    const showViolatorColumn = tbody?.dataset?.showViolator === 'true';
    const totalColumns = showViolatorColumn ? 8 : 7;
    showLoading(tbody);

    try {
        const data = await API.getTickets();
        const allTickets = Array.isArray(data?.tickets)
            ? data.tickets
            : Array.isArray(data?.data)
                ? data.data
                : [];

        if (data.success) {
            const sourceTickets = allTickets;
            const tickets = sourceTickets.slice(0, limit);
            renderHotspotViolations(sourceTickets);
            renderTicketsIssuedToday(sourceTickets);

            if (tickets.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="${totalColumns}" class="text-center">
                            <div class="empty-state">
                                <i class="fas fa-clipboard-list" aria-hidden="true"></i>
                                <h3>No tickets found</h3>
                                <p>Start issuing violation tickets to see them here</p>
                            </div>
                        </td>
                    </tr>
                `;
                return;
            }

            tbody.innerHTML = tickets.map(ticket => `
                <tr>
                    <td><strong>${escapeHtmlText(ticket.ticket_number)}</strong></td>
                    <td>${formatDate(ticket.date_issued)}</td>
                    ${showViolatorColumn ? `<td>${escapeHtmlText(ticket.owner_name || ticket.owner_name_at_issue || 'N/A')}</td>` : ''}
                    <td>${escapeHtmlText(ticket.plate_number)}</td>
                    <td>${escapeHtmlText(ticket.violation_name)}</td>
                    <td>${formatCurrency(ticket.penalty_amount)}</td>
                    <td>${getStatusBadge(ticket.status)}</td>
                    <td>
                        <button type="button" class="btn btn-sm btn-primary" onclick="viewTicketDetails(${ticket.id || ticket.ticket_id})">
                            View
                        </button>
                    </td>
                </tr>
            `).join('');
        }
    } catch (error) {
        console.error('Error loading tickets:', error);
        tbody.innerHTML = `
            <tr>
                <td colspan="${totalColumns}" class="text-center text-danger">
                    Failed to load tickets. Please try again.
                </td>
            </tr>
        `;
    }
};

// Render top violation percentages for hotspot panel
// Feature 10: Today's Activity - count tickets issued today (officer dashboard)
const renderTicketsIssuedToday = (tickets = []) => {
    const el = document.getElementById('ticketsToday');
    if (!el) return;

    const todayStr = new Date().toISOString().split('T')[0];
    const todayCount = tickets.filter((t) => {
        const issued = t.date_issued || t.issued_date || t.created_at;
        if (!issued) return false;
        return String(issued).split('T')[0] === todayStr;
    }).length;

    el.textContent = todayCount;
};

const renderHotspotViolations = (tickets = []) => {
    const hotspotList = document.getElementById('hotspotList');
    if (!hotspotList || !Array.isArray(tickets) || tickets.length === 0) return;

    const counts = tickets.reduce((acc, ticket) => {
        const violation = ticket.violation_name || 'Unspecified Violation';
        acc[violation] = (acc[violation] || 0) + 1;
        return acc;
    }, {});

    const total = tickets.length;
    const topItems = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    hotspotList.innerHTML = topItems.map(([name, count]) => {
        const percent = Math.max(5, Math.round((count / total) * 100));
        return `
            <div class="hotspot-item">
                <div class="hotspot-row"><span>${escapeHtmlText(name)}</span><span>${percent}%</span></div>
                <div class="hotspot-bar"><span style="width: ${percent}%"></span></div>
            </div>
        `;
    }).join('');
};

// View ticket details (navigate to detail page or show modal)
const viewTicketDetails = (ticketId) => {
    window.location.href = `ticket-details.html?id=${ticketId}`;
};

// Initialize dashboard
document.addEventListener('DOMContentLoaded', async () => {
    if (!isDashboardPage()) {
        return;
    }

    const hasDashboardWidgets = !!document.getElementById('totalTickets');
    const hasRecentTicketsTable = !!document.getElementById('recentTicketsBody');

    // Do nothing when this script is included on non-dashboard pages.
    if (!hasDashboardWidgets && !hasRecentTicketsTable) {
        return;
    }

    // Check authentication
    if (!requireAuth()) return;

    // Populate user info
    populateUserInfo();

    // Load data independently so one slow endpoint does not block others.
    if (hasDashboardWidgets) {
        loadDashboardStats();
    }

    renderBarangayRiskLevels();

    if (hasRecentTicketsTable) {
        loadRecentTickets();
    }
});
