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
        container.innerHTML = '<div class="spinner"></div>';
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

// Confirm dialog
const confirmAction = (message) => {
    return confirm(message);
};

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
};

// Normalize sidebar links/labels per role to keep tabs consistent across pages.
const normalizeSidebarForRole = () => {
    const user = getUser();
    if (!user) return;

    const nav = document.querySelector('.sidebar-nav');
    if (!nav) return;

    const findLink = (href) => nav.querySelector(`a.nav-item[href="${href}"]`);
    const setLinkLabel = (link, label) => {
        const span = link?.querySelector('span');
        if (span) span.textContent = label;
    };

    const adminOnlyHrefs = [
        'manage-violations.html',
        'manage-users.html',
        'reports.html',
        'audit-logs.html',
        'admin-overview.html',
        'admin-settings.html'
    ];

    const dashboardLink =
        findLink('admin-dashboard.html') ||
        findLink('officer-dashboard.html') ||
        nav.querySelector('a.nav-item[href*="dashboard.html"]');
    const ticketsLink = findLink('view-tickets.html');

    if (user.role === 'apprehending_officer') {
        adminOnlyHrefs.forEach((href) => {
            const link = findLink(href);
            if (link) link.style.display = 'none';
        });

        // Hide sidebar section titles that are admin-oriented for Apprehending Officers
        document.querySelectorAll('.nav-section-title').forEach(el => {
            const txt = (el.textContent || '').trim().toUpperCase();
            if (txt === 'MANAGEMENT' || txt === 'ADMIN TOOLS') {
                el.classList.add('nav-section-hidden');
            } else {
                el.classList.remove('nav-section-hidden');
            }
        });

        if (dashboardLink) {
            dashboardLink.setAttribute('href', 'officer-dashboard.html');
            setLinkLabel(dashboardLink, 'Dashboard');
        }

        if (ticketsLink) {
            setLinkLabel(ticketsLink, 'My Tickets');
        }
    } else if (user.role === 'admin') {
        adminOnlyHrefs.forEach((href) => {
            const link = findLink(href);
            if (link) link.style.display = '';
        });

        if (dashboardLink) {
            dashboardLink.setAttribute('href', 'admin-dashboard.html');
            setLinkLabel(dashboardLink, 'Dashboard');
        }

        if (ticketsLink) {
            setLinkLabel(ticketsLink, 'View Tickets');
        }

        // Ensure admin sees section titles
        document.querySelectorAll('.nav-section-title').forEach(el => el.classList.remove('nav-section-hidden'));
    }
};

// Close sidebar when clicking overlay
document.addEventListener('DOMContentLoaded', () => {
    const overlay = document.querySelector('.sidebar-overlay');
    if (overlay) {
        overlay.addEventListener('click', toggleSidebar);
    }

    // Menu toggle button
    const menuToggle = document.querySelector('.menu-toggle');
    if (menuToggle) {
        menuToggle.addEventListener('click', toggleSidebar);
    }

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
const logout = () => {
    if (confirmAction('Are you sure you want to logout?')) {
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

    inputs.forEach(input => {
        input.classList.remove('input-error');
        const errorMsg = input.parentElement.querySelector('.error-message');
        if (errorMsg) errorMsg.remove();

        if (!input.value.trim()) {
            isValid = false;
            input.classList.add('input-error');
            const error = document.createElement('div');
            error.className = 'error-message';
            error.textContent = 'This field is required';
            input.parentElement.appendChild(error);
        }
    });

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
