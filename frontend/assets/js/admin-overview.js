let revenueChart;
let statusChart;
let officerChart;

const numberValue = value => Number(value || 0);
const safeText = value => escapeHtmlText(String(value ?? ''));
const manilaDate = date => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(date);

const getOverviewRange = () => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 29);
    return { startDate: manilaDate(start), endDate: manilaDate(end) };
};

const showEmptyChart = (canvasId, message) => {
    const canvas = document.getElementById(canvasId);
    const parent = canvas?.parentElement;
    if (!parent || parent.querySelector('.chart-empty-state')) return;
    const note = document.createElement('p');
    note.className = 'chart-empty-state';
    note.style.cssText = 'text-align:center;color:var(--text-secondary);font-size:13px;margin:18px 0;';
    note.textContent = message;
    parent.appendChild(note);
};

const renderKPIs = async () => {
    const container = document.getElementById('kpiStats');
    if (!container) return;

    try {
        const [statsResponse, officersResponse] = await Promise.all([
            API.getDashboardStats(),
            API.getOfficerPerformance()
        ]);
        const stats = statsResponse.stats || statsResponse.data || {};
        const officers = officersResponse.performance || officersResponse.data || [];
        const revenue = numberValue(stats.revenue);
        const average = officers.length ? revenue / officers.length : 0;

        container.innerHTML = `
            <div class="stat-card">
                <div class="stat-header"><div class="stat-icon"><i class="fas fa-ticket-alt"></i></div></div>
                <div class="stat-label">Total Tickets</div>
                <h2 class="stat-value">${numberValue(stats.total)}</h2>
                <div class="stat-footer"><i class="fas fa-database"></i> Recorded citations</div>
            </div>
            <div class="stat-card success">
                <div class="stat-header"><div class="stat-icon"><i class="fas fa-check-circle"></i></div></div>
                <div class="stat-label">Paid Tickets</div>
                <h2 class="stat-value">${numberValue(stats.paid)}</h2>
                <div class="stat-footer"><i class="fas fa-receipt"></i> Fully settled</div>
            </div>
            <div class="stat-card danger">
                <div class="stat-header"><div class="stat-icon"><i class="fas fa-exclamation-circle"></i></div></div>
                <div class="stat-label">Unpaid Tickets</div>
                <h2 class="stat-value">${numberValue(stats.unpaid)}</h2>
                <div class="stat-footer"><i class="fas fa-hourglass-half"></i> Pending resolution</div>
            </div>
            <div class="stat-card warning">
                <div class="stat-header"><div class="stat-icon"><i class="fas fa-peso-sign"></i></div></div>
                <div class="stat-label">Recorded Collections</div>
                <h2 class="stat-value">${formatCurrency(revenue)}</h2>
                <div class="stat-footer"><i class="fas fa-users"></i> Average per active officer: ${formatCurrency(average)}</div>
            </div>`;
    } catch (error) {
        console.error('Failed to load overview KPIs:', error);
        container.innerHTML = '<div style="grid-column:1/-1;color:var(--danger-color);">Unable to load overview statistics.</div>';
    }
};

const renderCharts = async () => {
    const { startDate, endDate } = getOverviewRange();
    try {
        const [collections, paymentStatus, officers, violations] = await Promise.all([
            apiRequest(`/reports/analytics/collections?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`),
            apiRequest(`/reports/analytics/payment-status?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`),
            API.getOfficerProductivity(startDate, endDate),
            API.getViolationStats()
        ]);

        const daily = collections.data?.dailyData || [];
        const revenueContext = document.getElementById('revenueChart')?.getContext('2d');
        if (revenueContext && daily.length && typeof Chart !== 'undefined') {
            revenueChart?.destroy();
            revenueChart = new Chart(revenueContext, {
                type: 'line',
                data: {
                    labels: daily.map(item => formatDate(item.date)),
                    datasets: [{
                        label: 'Collections',
                        data: daily.map(item => numberValue(item.amount)),
                        borderColor: '#134074',
                        backgroundColor: 'rgba(19, 64, 116, 0.1)',
                        tension: 0.3,
                        fill: true
                    }]
                },
                options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true}} }
            });
        } else {
            showEmptyChart('revenueChart', 'No payment collections recorded in the selected 30-day period.');
        }

        const breakdown = paymentStatus.data?.breakdown || {};
        const statusValues = [numberValue(breakdown.paid), numberValue(breakdown.unpaid), numberValue(breakdown.disputed), numberValue(breakdown.cancelled)];
        const statusContext = document.getElementById('statusChart')?.getContext('2d');
        if (statusContext && statusValues.some(value => value > 0) && typeof Chart !== 'undefined') {
            statusChart?.destroy();
            statusChart = new Chart(statusContext, {
                type: 'doughnut',
                data: {
                    labels: ['Paid', 'Unpaid', 'Open Disputes', 'Cancelled'],
                    datasets: [{ data: statusValues, backgroundColor: ['#10b981', '#ef4444', '#f59e0b', '#94a3b8'] }]
                },
                options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom'}} }
            });
        } else {
            showEmptyChart('statusChart', 'No ticket-status data is available for the selected period.');
        }

        const performance = officers.performance || officers.data || [];
        const topOfficers = [...performance].sort((a, b) => numberValue(b.total_tickets) - numberValue(a.total_tickets)).slice(0, 5);
        const officerContext = document.getElementById('officerChart')?.getContext('2d');
        if (officerContext && topOfficers.length && typeof Chart !== 'undefined') {
            officerChart?.destroy();
            officerChart = new Chart(officerContext, {
                type: 'bar',
                data: {
                    labels: topOfficers.map(item => item.name || 'Officer'),
                    datasets: [{ label:'Tickets Issued', data:topOfficers.map(item => numberValue(item.total_tickets)), backgroundColor:'#1f8ea3' }]
                },
                options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true,ticks:{precision:0}}} }
            });
        } else {
            showEmptyChart('officerChart', 'No active-officer ticket activity is available for the selected period.');
        }

        const violationRows = (violations.stats || violations.data || []).slice(0, 5);
        const tbody = document.getElementById('violationsBody');
        if (tbody) {
            tbody.innerHTML = violationRows.length ? violationRows.map(item => `
                <tr>
                    <td>${safeText(item.violation_name || item.violation_code || 'Unspecified')}</td>
                    <td>${numberValue(item.count)}</td>
                    <td>${formatCurrency(numberValue(item.total_revenue))}</td>
                </tr>`).join('') : '<tr><td colspan="3" class="text-center">No violation records available.</td></tr>';
        }
    } catch (error) {
        console.error('Failed to load overview charts:', error);
        const tbody = document.getElementById('violationsBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="3" class="text-center">Unable to load analytics.</td></tr>';
    }
};

const renderActivitySummary = async () => {
    const summary = document.getElementById('activitySummary');
    if (!summary) return;

    try {
        const [logsResponse, disputesResponse, usersResponse] = await Promise.all([
            API.getAuditLogs(20),
            API.getDisputes({ status: 'submitted' }),
            API.getUsers()
        ]);
        const logs = (logsResponse.logs || logsResponse.data || []).slice(0, 5);
        const disputes = disputesResponse.disputes || disputesResponse.data || [];
        const activeOfficers = (usersResponse.users || usersResponse.data || []).filter(user => user.role === 'apprehending_officer' && user.status === 'active').length;

        summary.innerHTML = `
            <div>
                <h4 style="margin:0 0 12px"><i class="fas fa-history"></i> Latest Recorded Actions</h4>
                <ul style="list-style:none;padding:0;margin:0">
                    ${logs.length ? logs.map(item => `<li style="padding:8px;border-bottom:1px solid var(--border-color)"><small><strong>${safeText(item.action || 'SYSTEM_ACTION')}</strong></small><br><small style="color:var(--text-secondary)">${safeText(formatDateTime(item.created_at))}</small></li>`).join('') : '<li style="padding:8px;color:var(--text-secondary)">No recent actions.</li>'}
                </ul>
            </div>
            <div>
                <h4 style="margin:0 0 12px"><i class="fas fa-balance-scale"></i> Submitted Disputes</h4>
                <div style="text-align:center;padding:20px;background:var(--bg-secondary);border-radius:8px"><h2 style="margin:0;color:var(--warning-color)">${disputes.length}</h2><small>Awaiting review</small></div>
            </div>
            <div>
                <h4 style="margin:0 0 12px"><i class="fas fa-users"></i> Active Apprehending Officers</h4>
                <div style="text-align:center;padding:20px;background:var(--bg-secondary);border-radius:8px"><h2 style="margin:0;color:var(--info-color)">${activeOfficers}</h2><small>Authorized active users</small></div>
            </div>`;
    } catch (error) {
        console.error('Failed to load activity summary:', error);
        summary.innerHTML = '<div style="grid-column:1/-1;color:var(--danger-color)">Unable to load the recent system summary.</div>';
    }
};

const loadOverview = async () => {
    await Promise.all([renderKPIs(), renderCharts(), renderActivitySummary()]);
};

document.addEventListener('DOMContentLoaded', async () => {
    if (!requireAuth()) return;
    if (!isAdmin()) {
        window.location.href = 'officer-dashboard.html';
        return;
    }
    populateUserInfo();
    await loadOverview();
});
