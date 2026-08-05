// ==============================================
// API Configuration and Helper Functions
// ==============================================

const API_ORIGIN = (window.APP_CONFIG && window.APP_CONFIG.API_ORIGIN) ||
    ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? 'http://localhost:5000'
        : window.location.origin);
const API_BASE_URL = `${API_ORIGIN}/api`;

// Get authentication token from localStorage
const getToken = () => {
    return localStorage.getItem('token');
};

// Get user data from localStorage
const getUser = () => {
    const userData = localStorage.getItem('user');
    return userData ? JSON.parse(userData) : null;
};

// Save auth data
const saveAuth = (token, user) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
};

// Clear auth data
const clearAuth = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
};

const redirectToLoginWithNotice = (message = 'Session expired. Please login again.') => {
    clearAuth();

    try {
        sessionStorage.setItem('auth_notice', message);
    } catch (error) {
        // Ignore storage write errors.
    }

    if (!window.location.pathname.toLowerCase().endsWith('/login.html')) {
        window.location.href = 'login.html';
    }
};

// Check if user is authenticated
const isAuthenticated = () => {
    return !!getToken();
};

// Check if user is admin
const isAdmin = () => {
    const user = getUser();
    return user && user.role === 'admin';
};

// Redirect to login if not authenticated
const requireAuth = () => {
    if (!isAuthenticated()) {
        window.location.href = 'login.html';
        return false;
    }
    return true;
};

// Redirect to appropriate dashboard
const redirectToDashboard = () => {
    const user = getUser();

    if (!user) {
        window.location.href = 'login.html';
        return;
    }


    if (user.role === 'admin') {
        window.location.href = 'admin-dashboard.html';
    } else if (user.role === 'apprehending_officer') {
        window.location.href = 'officer-dashboard.html';
    } else {
        window.location.href = 'login.html';
    }
};

// API Request Helper
const apiRequest = async (endpoint, options = {}) => {
    const token = getToken();
    const hasToken = Boolean(token);
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;

    const config = {
        headers: {
            ...(token && { 'Authorization': `Bearer ${token}` })
        },
        ...options
    };

    if (!isFormData) {
        config.headers['Content-Type'] = 'application/json';
    }

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, config);
        let data = {};

        try {
            data = await response.json();
        } catch (parseError) {
            data = {};
        }

        if (!response.ok) {
            const responseMessage = String(data.message || '').toLowerCase();
            const isInvalidSession =
                response.status === 401 ||
                responseMessage.includes('user not found') ||
                responseMessage.includes('invalid session') ||
                responseMessage.includes('account is inactive');

            const isMissingToken =
                responseMessage.includes('no token provided') ||
                responseMessage.includes('access denied. no token provided');

            // Handle invalid/expired session
            if (isInvalidSession || (hasToken && isMissingToken)) {
                redirectToLoginWithNotice('Session invalid or expired. Please login again.');
                throw new Error('AUTH_REDIRECT');
            }

            // No token case: do not mark session as invalid; just require login.
            if (isMissingToken) {
                throw new Error('Authentication required. Please login.');
            }

            throw new Error(data.message || 'An error occurred');
        }

        return data;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
};

const apiBlobRequest = async (endpoint) => {
    const token = getToken();
    if (!token) throw new Error('Authentication required. Please login.');
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store'
    });
    if (response.status === 401 || response.status === 403) {
        if (response.status === 401) redirectToLoginWithNotice('Session invalid or expired. Please login again.');
        throw new Error(response.status === 403 ? 'Access denied.' : 'Session expired.');
    }
    if (!response.ok) throw new Error('Unable to load the protected file.');
    return response.blob();
};

// API Methods
const API = {
    // Auth
    login: (credentials) => apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials)
    }),

    requestPasswordReset: (email) => apiRequest('/auth/request-password-reset', {
        method: 'POST',
        body: JSON.stringify({ email })
    }),

    resetPassword: (token, newPassword) => apiRequest('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword })
    }),

    logout: async () => {
        try { await apiRequest('/auth/logout', { method: 'POST' }); } catch (error) { /* local session still ends */ }
        clearAuth();
        window.location.href = 'login.html';
    },

    getProfile: () => apiRequest('/auth/profile'),

    // Users
    getUsers: () => apiRequest('/users'),
    getUserById: (id) => apiRequest(`/users/${id}`),
    updateMyProfile: (profileData) => apiRequest('/users/me', {
        method: 'PUT',
        body: JSON.stringify(profileData)
    }),
    changePassword: (passwordData) => apiRequest('/users/change-password', {
        method: 'POST',
        body: JSON.stringify(passwordData)
    }),
    createUser: (userData) => apiRequest('/users', {
        method: 'POST',
        body: JSON.stringify(userData)
    }),
    updateUser: (id, userData) => apiRequest(`/users/${id}`, {
        method: 'PUT',
        body: JSON.stringify(userData)
    }),
    deleteUser: (id) => apiRequest(`/users/${id}`, {
        method: 'DELETE'
    }),
    unlockUser: (id) => apiRequest(`/users/${id}/unlock`, {
        method: 'POST'
    }),
    getAuditLogs: (limit = 200) => apiRequest(`/users/audit-logs?limit=${limit}`),
    clearTestAuditLogs: () => apiRequest('/users/audit-logs/clear', { method: 'DELETE' }),

    // Violations
    getViolations: () => apiRequest('/violations'),
    getActiveViolations: () => apiRequest('/violations/active'),
    getViolationById: (id) => apiRequest(`/violations/${id}`),
    createViolation: (violationData) => apiRequest('/violations', {
        method: 'POST',
        body: JSON.stringify(violationData)
    }),
    updateViolation: (id, violationData) => apiRequest(`/violations/${id}`, {
        method: 'PUT',
        body: JSON.stringify(violationData)
    }),
    getPenaltyPreview: (violationId, plateNumber) =>
        apiRequest(`/violations/${violationId}/penalty-preview?plateNumber=${encodeURIComponent(plateNumber)}`),
    deleteViolation: (id) => apiRequest(`/violations/${id}`, {
        method: 'DELETE'
    }),

    // Tickets
    getTickets: (filters = {}) => {
        const params = new URLSearchParams(filters);
        return apiRequest(`/tickets?${params}`);
    },
    getTicketById: (id) => apiRequest(`/tickets/${id}`),
    createTicket: (ticketData) => apiRequest('/tickets', {
        method: 'POST',
        body: JSON.stringify(ticketData)
    }),
    updateTicketDetails: async (id, detailsData) => {
        try {
            return await apiRequest(`/tickets/${id}/details`, {
                method: 'PUT',
                body: JSON.stringify(detailsData)
            });
        } catch (error) {
            const message = String(error?.message || '').toLowerCase();
            if (!message.includes('endpoint not found')) {
                throw error;
            }

            return apiRequest(`/tickets/${id}`, {
                method: 'PUT',
                body: JSON.stringify(detailsData)
            });
        }
    },
    updateTicketStatus: (id, statusData) => apiRequest(`/tickets/${id}`, {
        method: 'PUT',
        body: JSON.stringify(statusData)
    }),
    deleteTicket: (id, reason) => apiRequest(`/tickets/${id}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason })
    }),
    getDashboardStats: (filters = {}) => {
        const params = new URLSearchParams(filters);
        return apiRequest(`/tickets/stats?${params}`);
    },
    searchTickets: (query) => apiRequest(`/tickets/search?search=${encodeURIComponent(query)}`),

    // Payments
    recordPayment: (paymentData) => apiRequest('/payments', {
        method: 'POST',
        body: JSON.stringify(paymentData)
    }),
    getTicketPayments: (ticketId) => apiRequest(`/payments/ticket/${ticketId}`),

    // Evidence
    getTicketEvidence: (ticketId) => apiRequest(`/evidence/ticket/${ticketId}`),
    getEvidenceFile: (evidenceId) => apiBlobRequest(`/evidence/${evidenceId}/file`),
    uploadTicketEvidence: (ticketId, file) => {
        const formData = new FormData();
        formData.append('evidence', file);
        return apiRequest(`/evidence/ticket/${ticketId}`, {
            method: 'POST',
            body: formData
        });
    },

    // Disputes
    createDispute: (disputeData) => apiRequest('/disputes', {
        method: 'POST',
        body: JSON.stringify(disputeData)
    }),
    getDisputes: (filters = {}) => {
        const params = new URLSearchParams(filters);
        return apiRequest(`/disputes?${params}`);
    },
    resolveDispute: (id, disputeData) => apiRequest(`/disputes/${id}/resolve`, {
        method: 'PUT',
        body: JSON.stringify(disputeData)
    }),

    // Notifications
    getNotifications: (filters = {}) => {
        const params = new URLSearchParams(filters);
        return apiRequest(`/notifications?${params}`);
    },
    markNotificationRead: (id) => apiRequest(`/notifications/${id}/read`, {
        method: 'PUT'
    }),
    deleteNotification: (id) => apiRequest(`/notifications/${id}`, {
        method: 'DELETE'
    }),
    deleteNotificationsBulk: (ids) => apiRequest('/notifications/bulk', {
        method: 'DELETE',
        body: JSON.stringify({ ids })
    }),
    deleteAllNotifications: () => apiRequest('/notifications', {
        method: 'DELETE'
    }),

    // Reports
    getDailyReport: (date) => apiRequest(`/reports/daily?date=${date}`),
    getMonthlyReport: (year, month) => apiRequest(`/reports/monthly?year=${year}&month=${month}`),
    getYearlyReport: (year) => apiRequest(`/reports/yearly?year=${year}`),
    getCustomReport: (startDate, endDate) => apiRequest(`/reports/custom?startDate=${startDate}&endDate=${endDate}`),
    getViolationStats: () => apiRequest('/reports/violations'),
    getOfficerPerformance: () => apiRequest('/reports/officers'),
    getCollectionsSummary: (startDate, endDate) => apiRequest(`/reports/collections?startDate=${startDate}&endDate=${endDate}`),
    getHotspotsReport: (startDate, endDate) => apiRequest(`/reports/hotspots?startDate=${startDate}&endDate=${endDate}`),
    getOfficerProductivity: (startDate, endDate) => apiRequest(`/reports/productivity?startDate=${startDate}&endDate=${endDate}`),
    getReportPdfUrl: (queryString) => `${API_BASE_URL}/reports/export/pdf?${queryString}`,
    getOfficerPerformanceLGU: () => apiRequest('/reports/officer-performance'),
    getAgingReport: () => apiRequest('/reports/aging'),
    getBarangayReport: () => apiRequest('/reports/barangay'),

    // System Settings
    getSystemSettings: () => apiRequest('/system/settings'),
    getSettingValue: (key) => apiRequest(`/system/settings/${key}`),
    updateSystemSettings: (settings) => apiRequest('/system/settings', {
        method: 'PUT',
        body: JSON.stringify({ settings })
    }),
    updateBulkSettings: (updates) => apiRequest('/system/settings/bulk/update', {
        method: 'PUT',
        body: JSON.stringify({ updates })
    })
};

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { API, getToken, getUser, saveAuth, clearAuth, isAuthenticated, isAdmin, requireAuth, redirectToDashboard };
}
