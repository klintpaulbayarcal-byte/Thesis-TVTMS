let allAuditLogs = [];
let filteredAuditLogs = [];
let currentPage = 1;
const pageSize = 12;

const getActionBadgeClass = (action) => {
    if (!action) return 'badge-info';
    const actionLower = action.toLowerCase();
    if (actionLower.includes('dispute')) return 'badge-dispute';
    if (actionLower.includes('delete') || actionLower.includes('error')) return 'badge-danger';
    if (actionLower.includes('login') || actionLower.includes('success')) return 'badge-success';
    if (actionLower.includes('update') || actionLower.includes('create')) return 'badge-warning';
    return 'badge-info';
};

const formatDateTime = (value) => {
    if (!value) return 'N/A';
    const date = new Date(value);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    if (date.toDateString() === today.toDateString()) {
        return `Today ${timeStr}`;
    } else if (date.toDateString() === yesterday.toDateString()) {
        return `Yesterday ${timeStr}`;
    }
    return `${dateStr} ${timeStr}`;
};

const safeMetadata = (metadata) => {
    if (!metadata) return '';
    if (typeof metadata === 'object') {
        return JSON.stringify(metadata, null, 2);
    }
    return String(metadata);
};

const isPaginationDisabled = () => {
    const totalPages = Math.ceil(filteredAuditLogs.length / pageSize);
    document.getElementById('prevPageBtn').disabled = currentPage <= 1;
    document.getElementById('nextPageBtn').disabled = currentPage >= totalPages;
};

const updatePaginationUI = () => {
    const totalPages = Math.ceil(filteredAuditLogs.length / pageSize) || 1;
    document.getElementById('currentPage').textContent = currentPage;
    document.getElementById('totalPages').textContent = totalPages;
    document.getElementById('totalRecords').textContent = filteredAuditLogs.length;
    isPaginationDisabled();
};

const getCurrentPageLogs = () => {
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    return filteredAuditLogs.slice(start, end);
};

const renderAuditLogs = (logs) => {
    const container = document.getElementById('auditLogsContainer');
    if (!container) return;

    if (!Array.isArray(logs) || logs.length === 0) {
        container.innerHTML = `
            <div class="audit-logs-empty">
                <i class="fas fa-inbox"></i>
                <p>No audit logs found for selected filters.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = logs.map((log) => {
        const actor = log.actor_name || log.actor_email || `User #${log.user_id || '-'}`;
        const metadata = safeMetadata(log.metadata);
        const shortMetadata = metadata.length > 200 ? `${metadata.slice(0, 200)}...` : metadata;
        const badgeClass = getActionBadgeClass(log.action);
        const isDisputeAction = String(log.action || '').toLowerCase().includes('dispute');

        return `
            <div class="audit-log-card ${isDisputeAction ? 'audit-log-card-dispute' : ''}">
                <div class="audit-log-header">
                    <div class="audit-log-timestamp">
                        <i class="far fa-calendar"></i> ${escapeHtmlText(formatDateTime(log.created_at))}
                    </div>
                    <span class="audit-log-action-badge ${badgeClass}">${escapeHtmlText(log.action || 'UNKNOWN')}</span>
                </div>
                
                <p class="audit-log-actor">
                    <i class="fas fa-user-circle"></i> ${escapeHtmlText(actor)}
                </p>

                <div class="audit-log-details">
                    <div class="audit-detail-row">
                        <span class="audit-detail-label">Entity Type</span>
                        <span class="audit-detail-value">${escapeHtmlText(log.entity_type || '-')}</span>
                    </div>
                    <div class="audit-detail-row">
                        <span class="audit-detail-label">Entity ID</span>
                        <span class="audit-detail-value entity">${log.entity_id ? `#${Number(log.entity_id) || 0}` : '-'}</span>
                    </div>
                    <div class="audit-detail-row">
                        <span class="audit-detail-label">IP Address</span>
                        <span class="audit-detail-value entity">${escapeHtmlText(log.ip_address || '-')}</span>
                    </div>
                    <div class="audit-detail-row">
                        <span class="audit-detail-label">Source</span>
                        <span class="audit-detail-value" title="${escapeHtmlText(log.user_agent || 'N/A')}" style="font-size: 0.75rem; overflow: hidden; text-overflow: ellipsis;">
                            ${escapeHtmlText(log.user_agent ? log.user_agent.substring(0, 30) + '...' : '-')}
                        </span>
                    </div>
                </div>

                ${metadata ? `<div class="audit-log-metadata" title="${escapeHtmlText(metadata)}">${escapeHtmlText(shortMetadata)}</div>` : ''}
            </div>
        `;
    }).join('');
};

const applyFilters = () => {
    const actionKeyword = (document.getElementById('auditAction')?.value || '').toLowerCase();
    const actorKeyword = (document.getElementById('auditActor')?.value || '').toLowerCase();
    const entityKeyword = (document.getElementById('auditEntity')?.value || '').toLowerCase();
    const dateFrom = document.getElementById('auditDateFrom')?.value || '';
    const dateTo = document.getElementById('auditDateTo')?.value || '';

    filteredAuditLogs = allAuditLogs.filter((log) => {
        const action = String(log.action || '').toLowerCase();
        const actor = `${log.actor_name || ''} ${log.actor_email || ''}`.toLowerCase();
        const entity = String(log.entity_type || '').toLowerCase();
        const logDate = log.created_at ? String(log.created_at).split('T')[0] : '';

        const matchAction = !actionKeyword || action.includes(actionKeyword);
        const matchActor = !actorKeyword || actor.includes(actorKeyword);
        const matchEntity = !entityKeyword || entity.includes(entityKeyword);
        const matchDateFrom = !dateFrom || (logDate && logDate >= dateFrom);
        const matchDateTo = !dateTo || (logDate && logDate <= dateTo);

        return matchAction && matchActor && matchEntity && matchDateFrom && matchDateTo;
    });

    currentPage = 1;
    updatePaginationUI();
    renderAuditLogs(getCurrentPageLogs());
};

const goToPage = (pageNum) => {
    const totalPages = Math.ceil(filteredAuditLogs.length / pageSize) || 1;
    if (pageNum < 1 || pageNum > totalPages) return;
    currentPage = pageNum;
    updatePaginationUI();
    renderAuditLogs(getCurrentPageLogs());
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

const exportAuditLogsCSV = () => {
    if (!filteredAuditLogs || filteredAuditLogs.length === 0) {
        showAlert('No logs to export. Apply filters and try again.', 'warning');
        return;
    }

    const headers = ['Date', 'Actor', 'Action', 'Entity', 'IP Address', 'Metadata'];
    const rows = filteredAuditLogs.map((log) => {
        const actor = log.actor_name || log.actor_email || `User #${log.user_id || '-'}`;
        const entity = `${escapeHtmlText(log.entity_type || '-')} ${log.entity_id ? `#${log.entity_id}` : ''}`.trim();
        const metadata = safeMetadata(log.metadata);

        return [
            formatDateTime(log.created_at),
            actor,
            log.action || 'N/A',
            entity,
            log.ip_address || '-',
            metadata
        ].map(cell => {
            let str = String(cell).replace(/[\r\n]+/g, ' ');
            if (/^[=+@-]/.test(str)) str = `'${str}`;
            return str.includes(',') || str.includes('"')
                ? `"${str.replace(/"/g, '""')}"` : str;
        });
    });

    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.join(','))
    ].join('\n');

    const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const filename = `audit-logs-${timestamp}.csv`;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showAlert(`Exported ${filteredAuditLogs.length} records to ${filename}`, 'success', 2000);
};

const clearTestLogs = async () => {
    if (!confirm('Delete development test audit entries? Production audit records cannot be deleted from this screen.')) {
        return;
    }

    const clearBtn = document.getElementById('clearLogsBtn');
    if (!clearBtn) return;
    const originalText = clearBtn.innerHTML;
    clearBtn.disabled = true;
    clearBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Clearing...';

    try {
        const data = await API.clearTestAuditLogs();
        if (!data.success) throw new Error(data.message || 'Failed to clear test logs');
        const deleted = Number(data.deletedRows || 0);
        showAlert(data.message || `Removed ${deleted} test audit log(s).`, 'success', 2500);
        await loadAuditLogs();
    } catch (error) {
        console.error('Clear test logs error:', error);
        showAlert(error.message || 'Failed to clear test audit logs.', 'danger');
    } finally {
        clearBtn.disabled = false;
        clearBtn.innerHTML = originalText;
    }
};

const loadAuditLogs = async () => {
    const container = document.getElementById('auditLogsContainer');
    if (container) {
        container.innerHTML = '<div class="text-center" style="grid-column: 1 / -1; padding: 60px 20px;"><div class="spinner"></div></div>';
    }

    try {
        const response = await API.getAuditLogs(500);
        allAuditLogs = response.success ? (response.logs || []) : [];
        // Sort by latest first (DESC)
        allAuditLogs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        applyFilters();
    } catch (error) {
        console.error('Failed to load audit logs:', error);
        showAlert(error.message || 'Failed to load audit logs.', 'danger');
        if (container) {
            container.innerHTML = '<div class="audit-logs-empty"><i class="fas fa-exclamation-triangle"></i><p>Failed to load audit logs.</p></div>';
        }
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    if (!requireAuth()) return;

    if (!isAdmin()) {
        window.location.href = 'officer-dashboard.html';
        return;
    }

    populateUserInfo();
    await loadAuditLogs();

    document.getElementById('auditFilterForm')?.addEventListener('submit', (event) => {
        event.preventDefault();
        applyFilters();
    });

    document.getElementById('auditResetBtn')?.addEventListener('click', () => {
        document.getElementById('auditFilterForm')?.reset();
        applyFilters();
    });

    document.getElementById('auditDisputePresetBtn')?.addEventListener('click', () => {
        const actionInput = document.getElementById('auditAction');
        const actorInput = document.getElementById('auditActor');

        if (actionInput) actionInput.value = 'DISPUTE_';
        if (actorInput) actorInput.value = '';
        applyFilters();
    });

    document.getElementById('refreshLogsBtn')?.addEventListener('click', async () => {
        await loadAuditLogs();
        showAlert('Audit logs refreshed.', 'success', 1500);
    });

    document.getElementById('clearLogsBtn')?.addEventListener('click', clearTestLogs);

    document.getElementById('prevPageBtn')?.addEventListener('click', () => {
        goToPage(currentPage - 1);
    });

    document.getElementById('nextPageBtn')?.addEventListener('click', () => {
        goToPage(currentPage + 1);
    });

    document.getElementById('exportCsvBtn')?.addEventListener('click', () => {
        exportAuditLogsCSV();
    });
});