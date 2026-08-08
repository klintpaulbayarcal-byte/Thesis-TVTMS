// ==============================================
// Main JavaScript Functions
// ==============================================

// Escape untrusted values before inserting them into HTML templates.
const escapeHtmlText = (value) => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);
window.escapeHtmlText = escapeHtmlText;

// Show loading spinner
const showLoading = (container) => {
    if (typeof container === 'string') {
        container = document.querySelector(container);
    }
    if (container) {
        if (container.tagName === 'TBODY') {
            const table = container.closest('table');
            const columnCount = Math.max(table?.querySelectorAll('thead th').length || 1, 1);
            container.innerHTML = Array.from({ length: 4 }, () => `
                <tr class="skeleton-row" aria-hidden="true">
                    ${Array.from({ length: columnCount }, () => '<td><span class="skeleton-line"></span></td>').join('')}
                </tr>
            `).join('');
            container.setAttribute('aria-busy', 'true');
        } else {
            container.innerHTML = `
                <div class="skeleton-block" style="height:72px;margin-bottom:12px" aria-hidden="true"></div>
                <div class="skeleton-line" style="width:78%;margin-bottom:10px" aria-hidden="true"></div>
                <div class="skeleton-line" style="width:56%" aria-hidden="true"></div>`;
            container.setAttribute('aria-busy', 'true');
        }

        const loadingObserver = new MutationObserver(() => {
            container.removeAttribute('aria-busy');
            loadingObserver.disconnect();
        });
        loadingObserver.observe(container, { childList: true });
    }
};

// Show alert message
const showAlert = (message, type = 'info', duration = 3000) => {
    const path = (window.location.pathname || '').toLowerCase();
    const isDashboardScreen = path.endsWith('/admin-dashboard.html') || path.endsWith('/officer-dashboard.html');

    // Defensive guard: this alert should only appear on actual dashboard pages.
    if (String(message || '').trim() === 'Failed to load dashboard statistics' && !isDashboardScreen) {
        return;
    }

    const alertContainer = document.getElementById('alertContainer');
    if (!alertContainer) {
        console.warn('Alert container not found');
        return;
    }

    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    alert.textContent = message;

    alertContainer.appendChild(alert);

    if (duration > 0) {
        setTimeout(() => {
            alert.style.transition = 'opacity 0.3s';
            alert.style.opacity = '0';
            setTimeout(() => alert.remove(), 300);
        }, duration);
    }

    return alert;
};

// Reusable accessible confirmation dialog. This intentionally replaces browser confirm().
const ensureConfirmationDialog = () => {
    let modal = document.getElementById('appConfirmationModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'appConfirmationModal';
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-hidden', 'true');
    modal.setAttribute('aria-labelledby', 'appConfirmationTitle');
    modal.setAttribute('aria-describedby', 'appConfirmationMessage');
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3 id="appConfirmationTitle"><i class="fas fa-circle-exclamation" aria-hidden="true"></i> Confirm Action</h3>
                <button type="button" class="modal-close-button" data-confirm-result="false" aria-label="Close confirmation">
                    <i class="fas fa-times" aria-hidden="true"></i>
                </button>
            </div>
            <div class="modal-body">
                <p id="appConfirmationMessage"></p>
                <div id="appConfirmationInputGroup" class="form-group" hidden style="margin-top:16px">
                    <label id="appConfirmationInputLabel" for="appConfirmationInput">Reason</label>
                    <textarea id="appConfirmationInput" rows="3" maxlength="500"></textarea>
                    <div id="appConfirmationInputError" class="field-error" role="alert" hidden></div>
                </div>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-confirm-result="false"><i class="fas fa-times" aria-hidden="true"></i> Cancel</button>
                <button type="button" class="btn btn-primary" id="appConfirmationAccept" data-confirm-result="true"><i class="fas fa-check" aria-hidden="true"></i> Continue</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    return modal;
};

const requestConfirmation = (message, options = {}) => new Promise((resolve) => {
    const modal = ensureConfirmationDialog();
    const title = modal.querySelector('#appConfirmationTitle');
    const messageElement = modal.querySelector('#appConfirmationMessage');
    const acceptButton = modal.querySelector('#appConfirmationAccept');
    const inputGroup = modal.querySelector('#appConfirmationInputGroup');
    const inputLabel = modal.querySelector('#appConfirmationInputLabel');
    const input = modal.querySelector('#appConfirmationInput');
    const inputError = modal.querySelector('#appConfirmationInputError');
    const destructive = Boolean(options.destructive);

    title.innerHTML = `<i class="fas ${destructive ? 'fa-triangle-exclamation' : 'fa-circle-question'}" aria-hidden="true"></i> ${escapeHtmlText(options.title || 'Confirm Action')}`;
    messageElement.textContent = message;
    acceptButton.className = `btn ${destructive ? 'btn-danger' : 'btn-primary'}`;
    acceptButton.innerHTML = `<i class="fas ${destructive ? 'fa-trash-alt' : 'fa-check'}" aria-hidden="true"></i> ${escapeHtmlText(options.confirmLabel || 'Continue')}`;
    inputGroup.hidden = !options.input;
    inputLabel.textContent = options.input?.label || 'Reason';
    input.placeholder = options.input?.placeholder || '';
    input.value = options.input?.value || '';
    input.maxLength = options.input?.maxLength || 500;
    inputError.hidden = true;
    input.removeAttribute('aria-invalid');

    let settled = false;
    const finish = (result) => {
        if (settled) return;

        if (result && options.input) {
            const value = input.value.trim();
            const minimum = options.input.minLength || 0;
            if (value.length < minimum) {
                inputError.textContent = options.input.errorMessage || `Please enter at least ${minimum} characters.`;
                inputError.hidden = false;
                input.setAttribute('aria-invalid', 'true');
                input.focus();
                return;
            }
            settled = true;
            close();
            resolve(value);
            return;
        }

        settled = true;
        close();
        resolve(result ? true : (options.input ? null : false));
    };

    const onClick = (event) => {
        const button = event.target.closest('[data-confirm-result]');
        if (button) finish(button.dataset.confirmResult === 'true');
        else if (event.target === modal) finish(false);
    };
    const onKeyDown = (event) => {
        if (event.key === 'Escape') finish(false);
    };
    const close = () => {
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
        modal.removeEventListener('click', onClick);
        document.removeEventListener('keydown', onKeyDown);
    };

    modal.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeyDown);
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    if (options.input) input.focus();
    else acceptButton.focus();
});

const confirmAction = (message, options = {}) => requestConfirmation(message, options);
const requestTextConfirmation = (message, inputOptions, options = {}) => requestConfirmation(message, {
    ...options,
    input: inputOptions
});
window.confirmAction = confirmAction;
window.requestTextConfirmation = requestTextConfirmation;

// Format date
const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
};

// Format time
const formatTime = (timeString) => {
    if (!timeString) return 'N/A';
    const [hours, minutes] = timeString.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
};

// Shared date-time formatter for pages that display audit or activity timestamps.
// Assigned on window so page-specific modules may still use their own local helper.
window.formatDateTime = window.formatDateTime || ((value) => {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
});

// Format currency
const formatCurrency = (amount) => {
    if (amount === null || amount === undefined) return '₱0.00';
    return '₱' + parseFloat(amount).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
};

// Get status badge HTML from a strict allowlist.
const getStatusBadge = (status) => {
    const normalized = String(status || '').toLowerCase();
    const badges = {
        paid: '<span class="badge badge-success">Paid</span>',
        unpaid: '<span class="badge badge-danger">Unpaid</span>',
        cancelled: '<span class="badge badge-secondary">Cancelled</span>',
        active: '<span class="badge badge-success">Active</span>',
        inactive: '<span class="badge badge-secondary">Inactive</span>',
        submitted: '<span class="badge badge-info">Submitted</span>',
        under_review: '<span class="badge badge-warning">Under Review</span>',
        approved: '<span class="badge badge-success">Approved</span>',
        rejected: '<span class="badge badge-danger">Rejected</span>',
        closed: '<span class="badge badge-secondary">Closed</span>',
        partial: '<span class="badge badge-warning">Partial</span>',
        full: '<span class="badge badge-success">Full</span>',
        voided: '<span class="badge badge-secondary">Voided</span>'
    };
    return badges[normalized] || '<span class="badge badge-info">Unknown</span>';
};

// Populate user info in sidebar
const populateUserInfo = () => {
    const user = getUser();
    if (!user) return;

    const userNameElements = document.querySelectorAll('.user-name');
    const userRoleElements = document.querySelectorAll('.user-role');
    const userAvatarElements = document.querySelectorAll('.user-avatar');

    const roleMap = {
        admin: 'Administrator',
        apprehending_officer: 'Apprehending Officer'
    };

    userNameElements.forEach(el => el.textContent = user.name);
    userRoleElements.forEach(el => el.textContent = roleMap[user.role] || user.role);
    userAvatarElements.forEach(el => {
        const initials = user.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        el.textContent = initials;
    });
};

// Toggle sidebar (for mobile)
const toggleSidebar = () => {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');

    if (sidebar) {
        sidebar.classList.toggle('active');
    }

    if (overlay) {
        overlay.classList.toggle('active');
    }

    const menuToggle = document.querySelector('.menu-toggle');
    if (menuToggle) menuToggle.setAttribute('aria-expanded', String(Boolean(sidebar?.classList.contains('active'))));
};

// Normalize sidebar links/labels per role to keep tabs consistent across pages.
const normalizeSidebarForRole = () => {
    const user = getUser();
    if (!user) return;

    const nav = document.querySelector('.sidebar-nav');
    if (!nav) return;

    const adminSections = [
        ['MAIN', [
            ['admin-dashboard.html', 'fa-chart-line', 'Dashboard'],
            ['admin-overview.html', 'fa-gauge-high', 'Overview']
        ]],
        ['ENFORCEMENT', [
            ['issue-ticket.html', 'fa-circle-plus', 'Issue Ticket'],
            ['view-tickets.html', 'fa-ticket', 'View Tickets'],
            ['license-plate-lookup.html', 'fa-magnifying-glass', 'Search Violator']
        ]],
        ['MANAGEMENT', [
            ['manage-violations.html', 'fa-triangle-exclamation', 'Violations'],
            ['manage-users.html', 'fa-users', 'Users'],
            ['payments.html', 'fa-money-bill-wave', 'Payments'],
            ['disputes.html', 'fa-scale-balanced', 'Disputes']
        ]],
        ['ANALYTICS', [
            ['reports.html', 'fa-file-lines', 'Reports'],
            ['analytics-dashboard.html', 'fa-chart-column', 'Analytics']
        ]],
        ['ADMIN TOOLS', [
            ['audit-logs.html', 'fa-clock-rotate-left', 'Audit Trail'],
            ['notifications.html', 'fa-bell', 'Notifications'],
            ['admin-settings.html', 'fa-gear', 'Settings']
        ]],
        ['ACCOUNT', [
            ['profile.html', 'fa-id-card', 'Profile']
        ]]
    ];
    const officerSections = [
        ['MAIN', [
            ['officer-dashboard.html', 'fa-chart-line', 'Dashboard']
        ]],
        ['ENFORCEMENT', [
            ['issue-ticket.html', 'fa-circle-plus', 'Issue Ticket'],
            ['view-tickets.html', 'fa-ticket', 'My Tickets'],
            ['license-plate-lookup.html', 'fa-magnifying-glass', 'Search Violator']
        ]],
        ['WORKFLOW', [
            ['disputes.html', 'fa-scale-balanced', 'Disputes'],
            ['notifications.html', 'fa-bell', 'Notifications']
        ]],
        ['ACCOUNT', [
            ['profile.html', 'fa-id-card', 'Profile']
        ]]
    ];
    const sections = user.role === 'admin' ? adminSections : officerSections;
    const currentPage = window.location.pathname.split('/').pop();

    nav.innerHTML = sections.map(([title, links]) => `
        <div class="nav-section-title">${title}</div>
        ${links.map(([href, icon, label]) => `
            <a href="${href}" class="nav-item${currentPage === href ? ' active' : ''}"${currentPage === href ? ' aria-current="page"' : ''}>
                <i class="fas ${icon}" aria-hidden="true"></i><span>${label}</span>
            </a>`).join('')}
    `).join('') + `
        <a href="#" class="nav-item" data-action="logout">
            <i class="fas fa-right-from-bracket" aria-hidden="true"></i><span>Logout</span>
        </a>`;

    nav.querySelector('[data-action="logout"]')?.addEventListener('click', (event) => {
        event.preventDefault();
        logout();
    });
};

// Enforce page access before page-specific API work begins.
const enforcePageRoleGuard = () => {
    const page = (window.location.pathname.split('/').pop() || '').toLowerCase();
    const adminOnlyPages = new Set([
        'admin-dashboard.html', 'admin-overview.html', 'admin-settings.html',
        'analytics-dashboard.html', 'audit-logs.html', 'manage-users.html',
        'manage-violations.html', 'payments.html', 'reports.html'
    ]);
    const officerOnlyPages = new Set(['officer-dashboard.html']);
    const sharedProtectedPages = new Set([
        'issue-ticket.html', 'view-tickets.html', 'license-plate-lookup.html',
        'ticket-details.html', 'notifications.html', 'profile.html', 'disputes.html'
    ]);

    if (!adminOnlyPages.has(page) && !officerOnlyPages.has(page) && !sharedProtectedPages.has(page)) {
        return true;
    }

    const user = getUser();
    if (!isAuthenticated() || !user) {
        window.__pageAccessDenied = true;
        window.location.replace('login.html');
        return false;
    }

    if (!['admin', 'apprehending_officer'].includes(user.role)) {
        window.__pageAccessDenied = true;
        clearAuth();
        try { sessionStorage.setItem('auth_notice', 'Your account is not authorized for this system area.'); } catch (error) { /* Storage may be unavailable. */ }
        window.location.replace('login.html');
        return false;
    }

    if (adminOnlyPages.has(page) && user.role !== 'admin') {
        window.__pageAccessDenied = true;
        window.location.replace('officer-dashboard.html');
        return false;
    }

    if (officerOnlyPages.has(page) && user.role !== 'apprehending_officer') {
        window.__pageAccessDenied = true;
        window.location.replace('admin-dashboard.html');
        return false;
    }

    document.documentElement.dataset.authorizedRole = user.role;
    return true;
};
window.enforcePageRoleGuard = enforcePageRoleGuard;
enforcePageRoleGuard();

// Close sidebar when clicking overlay
document.addEventListener('DOMContentLoaded', () => {
    const overlay = document.querySelector('.sidebar-overlay');
    if (overlay) {
        overlay.addEventListener('click', toggleSidebar);
    }

    // Menu toggle button
    const menuToggle = document.querySelector('.menu-toggle');
    if (menuToggle) {
        menuToggle.type = 'button';
        if (!menuToggle.hasAttribute('aria-label')) menuToggle.setAttribute('aria-label', 'Open navigation menu');
        menuToggle.setAttribute('aria-expanded', 'false');
        menuToggle.addEventListener('click', toggleSidebar);
    }

    document.querySelectorAll('.search-bar input, input[type="search"]').forEach((input) => {
        if (!input.hasAttribute('aria-label')) input.setAttribute('aria-label', input.placeholder || 'Search');
    });

    document.querySelectorAll('input[type="tel"], input[id*="contact" i], input[id*="phone" i]').forEach((input) => {
        input.setAttribute('inputmode', 'tel');
        if (!input.placeholder) input.placeholder = 'e.g., 0912 345 6789';
    });

    document.querySelectorAll('input[id*="plate" i]').forEach((input) => {
        input.setAttribute('autocapitalize', 'characters');
        input.addEventListener('input', () => {
            const start = input.selectionStart;
            input.value = input.value.toUpperCase().replace(/[^A-Z0-9 -]/g, '');
            if (start !== null) input.setSelectionRange(start, start);
        });
    });

    document.querySelectorAll('input[id*="license" i]').forEach((input) => {
        input.setAttribute('autocapitalize', 'characters');
        if (!input.placeholder) input.placeholder = 'e.g., N01-23-456789';
    });

    document.querySelectorAll('input[type="number"][id*="amount" i], input[type="number"][id*="penalty" i]').forEach((input) => {
        input.setAttribute('inputmode', 'decimal');
        if (!input.placeholder) input.placeholder = 'e.g., 500.00';
    });

    // Populate user info
    if (isAuthenticated()) {
        normalizeSidebarForRole();
        populateUserInfo();
    }

    // Highlight active nav item
    const currentPage = window.location.pathname.split('/').pop();
    document.querySelectorAll('.nav-item').forEach(item => {
        const href = item.getAttribute('href');
        if (href === currentPage) {
            item.classList.add('active');
        }
    });
});

// Logout function
const logout = async () => {
    if (await confirmAction('End your current session and return to the login page?', {
        title: 'Log Out',
        confirmLabel: 'Log Out'
    })) {
        API.logout();
    }
};

// Debounce function for search
const debounce = (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

// Print ticket
const printTicket = () => {
    window.print();
};

// Export to CSV
const exportToCSV = (data, filename) => {
    if (!data || data.length === 0) {
        showAlert('No data to export', 'warning');
        return;
    }

    const headers = Object.keys(data[0]);
    const csvCell = value => {
        let text = value === null || value === undefined ? '' : String(value);
        if (/^[=+@-]/.test(text)) text = `'${text}`;
        return `"${text.replace(/"/g, '""')}"`;
    };
    const csvContent = '\uFEFF' + [
        headers.map(csvCell).join(','),
        ...data.map(row => headers.map(header => csvCell(row[header])).join(','))
    ].join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

// Modal functions
const openModal = (modalId) => {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
    }
};

const closeModal = (modalId) => {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
    }
};

// Close modal when clicking outside
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.classList.remove('active');
    }
});

// Form validation helper
const validateForm = (formId) => {
    const form = document.getElementById(formId);
    if (!form) return false;

    const inputs = form.querySelectorAll('input[required], select[required], textarea[required]');
    let isValid = true;

    let firstInvalid = null;
    inputs.forEach(input => {
        input.classList.remove('input-error');
        input.removeAttribute('aria-invalid');
        const errorMsg = input.parentElement.querySelector('.error-message');
        if (errorMsg) errorMsg.remove();

        if (!input.value.trim()) {
            isValid = false;
            if (!firstInvalid) firstInvalid = input;
            input.classList.add('input-error');
            input.setAttribute('aria-invalid', 'true');
            const error = document.createElement('div');
            error.className = 'error-message';
            error.setAttribute('role', 'alert');
            const label = form.querySelector(`label[for="${CSS.escape(input.id)}"]`);
            const fieldName = (label?.textContent || input.name || 'This field').replace('*', '').trim();
            error.textContent = `${fieldName} is required.`;
            input.parentElement.appendChild(error);
        }
    });

    if (firstInvalid) firstInvalid.focus();

    return isValid;
};

// Initialize tooltips (if using library)
const initTooltips = () => {
    // Add tooltip initialization if needed
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initTooltips();
});

// Handle errors globally
window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    showAlert('An unexpected error occurred. Please try again.', 'danger');
});
