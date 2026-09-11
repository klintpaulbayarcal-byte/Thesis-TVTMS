// ==============================================
// API Configuration and Helper Functions
// ==============================================

const STABLE_VERCEL_API_ORIGIN = 'https://thesis-tvtms-api.vercel.app';
const CURRENT_HOST = String(window.location.hostname || '').toLowerCase();
const IS_SCHOOL_HOST = CURRENT_HOST === 'trafficviolation.dcsbisu.com';
const CONFIGURED_API_ORIGIN = window.APP_CONFIG && window.APP_CONFIG.API_ORIGIN;
const API_ORIGIN = IS_SCHOOL_HOST
    ? STABLE_VERCEL_API_ORIGIN
    : (CONFIGURED_API_ORIGIN || window.location.origin);
const API_BASE_URL = `${String(API_ORIGIN).replace(/\/$/, '')}/api`;

const isNetworkFetchError = (error) =>
    error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(String(error?.message || ''));

const getToken = () => localStorage.getItem('token');
const getUser = () => {
    const userData = localStorage.getItem('user');
    return userData ? JSON.parse(userData) : null;
};
const saveAuth = (token, user) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
};
const clearAuth = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
};

const redirectToLoginWithNotice = (message = 'Session expired. Please login again.') => {
    clearAuth();
    try { sessionStorage.setItem('auth_notice', message); } catch (error) {}
    if (!window.location.pathname.toLowerCase().endsWith('/login.html')) window.location.href = 'login.html';
};

const isAuthenticated = () => !!getToken();
const isAdmin = () => {
    const user = getUser();
    return user && user.role === 'admin';
};
const requireAuth = () => {
    if (!isAuthenticated()) {
        window.location.href = 'login.html';
        return false;
    }
    return true;
};
const redirectToDashboard = () => {
    const user = getUser();
    if (!user) return void (window.location.href = 'login.html');
    if (user.role === 'admin') window.location.href = 'admin-dashboard.html';
    else if (user.role === 'apprehending_officer') window.location.href = 'officer-dashboard.html';
    else window.location.href = 'login.html';
};

const apiRequest = async (endpoint, options = {}) => {
    const token = getToken();
    const hasToken = Boolean(token);
    const requestOptions = options;
    const isFormData = typeof FormData !== 'undefined' && requestOptions.body instanceof FormData;
    const config = {
        headers: { ...(token && { 'Authorization': `Bearer ${token}` }) },
        ...requestOptions
    };
    if (!isFormData) config.headers['Content-Type'] = 'application/json';

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, config);
        let data = {};
        try { data = await response.json(); } catch (parseError) { data = {}; }

        if (!response.ok) {
            const responseMessage = String(data.message || '').toLowerCase();
            const isInvalidSession = hasToken && (
                response.status === 401 ||
                responseMessage.includes('user not found') ||
                responseMessage.includes('invalid session') ||
                responseMessage.includes('account is inactive')
            );
            const isMissingToken = responseMessage.includes('no token provided') || responseMessage.includes('access denied. no token provided');
            if (isInvalidSession || (hasToken && isMissingToken)) {
                redirectToLoginWithNotice('Session invalid or expired. Please login again.');
                throw new Error('AUTH_REDIRECT');
            }
            if (isMissingToken) throw new Error('Authentication required. Please login.');
            throw new Error(data.message || `Request failed (${response.status}).`);
        }
        return data;
    } catch (error) {
        console.error('API Error:', error, { endpoint, apiBase: API_BASE_URL });
        if (isNetworkFetchError(error)) {
            throw new Error('Unable to connect to the system service. Please refresh and try again.');
        }
        throw error;
    }
};

const apiBlobRequest = async (endpoint) => {
    const token = getToken();
    if (!token) throw new Error('Authentication required. Please login.');
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store'
    });
    if (response.status === 401 || response.status === 403) {
        if (response.status === 401) redirectToLoginWithNotice('Session invalid or expired. Please login again.');
        throw new Error(response.status === 403 ? 'Access denied.' : 'Session expired.');
    }
    if (!response.ok) throw new Error('Unable to load the protected file.');
    return response.blob();
};

const API = {
    login: (credentials) => apiRequest('/auth/login', { method: 'POST', body: JSON.stringify(credentials), cache: 'no-store' }),
    requestPasswordReset: (email) => apiRequest('/auth/request-password-reset', { method: 'POST', body: JSON.stringify({ email }) }),
    resetPassword: (token, newPassword) => apiRequest('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, newPassword }) }),
    logout: async () => { try { await apiRequest('/auth/logout', { method: 'POST' }); } catch (error) {} clearAuth(); window.location.href = 'login.html'; },
    getProfile: () => apiRequest('/auth/profile'),
    getUsers: () => apiRequest('/users'),
    getUserById: (id) => apiRequest(`/users/${id}`),
    updateMyProfile: (profileData) => apiRequest('/users/me', { method: 'PUT', body: JSON.stringify(profileData) }),
    changePassword: (passwordData) => apiRequest('/users/change-password', { method: 'POST', body: JSON.stringify(passwordData) }),
    createUser: (userData) => apiRequest('/users', { method: 'POST', body: JSON.stringify(userData) }),
    updateUser: (id, userData) => apiRequest(`/users/${id}`, { method: 'PUT', body: JSON.stringify(userData) }),
    deleteUser: (id) => apiRequest(`/users/${id}`, { method: 'DELETE' }),
    unlockUser: (id) => apiRequest(`/users/${id}/unlock`, { method: 'POST' }),
    getAuditLogs: (limit = 200) => apiRequest(`/users/audit-logs?limit=${limit}`),
    clearTestAuditLogs: () => apiRequest('/users/audit-logs/clear', { method: 'DELETE' }),
    getViolations: () => apiRequest('/violations'),
    getActiveViolations: () => apiRequest('/violations/active'),
    getViolationById: (id) => apiRequest(`/violations/${id}`),
    createViolation: (violationData) => apiRequest('/violations', { method: 'POST', body: JSON.stringify(violationData) }),
    updateViolation: (id, violationData) => apiRequest(`/violations/${id}`, { method: 'PUT', body: JSON.stringify(violationData) }),
    getPenaltyPreview: (violationId, plateNumber) => apiRequest(`/violations/${violationId}/penalty-preview?plateNumber=${encodeURIComponent(plateNumber)}`),
    deleteViolation: (id) => apiRequest(`/violations/${id}`, { method: 'DELETE' }),
    getTickets: (filters = {}) => apiRequest(`/tickets?${new URLSearchParams(filters)}`),
    getTicketById: (id) => apiRequest(`/tickets/${id}`),
    createTicket: (ticketData) => apiRequest('/tickets', { method: 'POST', body: JSON.stringify(ticketData) }),
    updateTicketDetails: async (id, detailsData) => {
        try { return await apiRequest(`/tickets/${id}/details`, { method: 'PUT', body: JSON.stringify(detailsData) }); }
        catch (error) { if (!String(error?.message || '').toLowerCase().includes('endpoint not found')) throw error; return apiRequest(`/tickets/${id}`, { method: 'PUT', body: JSON.stringify(detailsData) }); }
    },
    updateTicketStatus: (id, statusData) => apiRequest(`/tickets/${id}`, { method: 'PUT', body: JSON.stringify(statusData) }),
    deleteTicket: (id, reason) => apiRequest(`/tickets/${id}`, { method: 'DELETE', body: JSON.stringify({ reason }) }),
    permanentlyDeleteTicket: (id, reason) => apiRequest(`/tickets/${id}/permanent`, { method: 'DELETE', body: JSON.stringify({ reason }) }),
    markTicketUnpaid: (id, reason) => apiRequest(`/tickets/${id}/mark-unpaid`, { method: 'PUT', body: JSON.stringify({ reason }) }),
    getDashboardStats: (filters = {}) => apiRequest(`/tickets/stats?${new URLSearchParams(filters)}`),
    searchTickets: (query) => apiRequest(`/tickets/search?search=${encodeURIComponent(query)}`),
    recordPayment: (paymentData) => apiRequest('/payments', { method: 'POST', body: JSON.stringify(paymentData) }),
    getTicketPayments: (ticketId) => apiRequest(`/payments/ticket/${ticketId}`),
    getTicketEvidence: (ticketId) => apiRequest(`/evidence/ticket/${ticketId}`),
    getEvidenceFile: (evidenceId) => apiBlobRequest(`/evidence/${evidenceId}/file`),
    uploadTicketEvidence: (ticketId, file) => { const formData = new FormData(); formData.append('evidence', file); return apiRequest(`/evidence/ticket/${ticketId}`, { method: 'POST', body: formData }); },
    createDispute: (disputeData) => apiRequest('/disputes', { method: 'POST', body: JSON.stringify(disputeData) }),
    getDisputes: (filters = {}) => apiRequest(`/disputes?${new URLSearchParams(filters)}`),
    resolveDispute: (id, disputeData) => apiRequest(`/disputes/${id}/resolve`, { method: 'PUT', body: JSON.stringify(disputeData) }),
    getNotifications: (filters = {}) => apiRequest(`/notifications?${new URLSearchParams(filters)}`),
    markNotificationRead: (id) => apiRequest(`/notifications/${id}/read`, { method: 'PUT' }),
    deleteNotification: (id) => apiRequest(`/notifications/${id}`, { method: 'DELETE' }),
    deleteNotificationsBulk: (ids) => apiRequest('/notifications/bulk', { method: 'DELETE', body: JSON.stringify({ ids }) }),
    deleteAllNotifications: () => apiRequest('/notifications', { method: 'DELETE' }),
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
    getSystemSettings: () => apiRequest('/system/settings'),
    getSettingValue: (key) => apiRequest(`/system/settings/${key}`),
    updateSystemSettings: (settings) => apiRequest('/system/settings', { method: 'PUT', body: JSON.stringify({ settings }) }),
    updateBulkSettings: (updates) => apiRequest('/system/settings/bulk/update', { method: 'PUT', body: JSON.stringify({ updates }) })
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { API, getToken, getUser, saveAuth, clearAuth, isAuthenticated, isAdmin, requireAuth, redirectToDashboard };
}
