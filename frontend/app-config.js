/**
 * Runtime frontend configuration.
 *
 * Recommended production setup: serve the frontend and reverse-proxy /api to the Node.js backend. In that setup API_ORIGIN stays blank.
 *
 * When the API is hosted on a different HTTPS origin, set it here, for example:
 *   window.APP_CONFIG.API_ORIGIN = 'https://api.example.gov.ph';
 */
window.APP_CONFIG = window.APP_CONFIG || {};
window.APP_CONFIG.API_ORIGIN = String(window.APP_CONFIG.API_ORIGIN || '').replace(/\/$/, '');
