/**
 * Runtime frontend configuration.
 *
 * Recommended production setup: serve the frontend and reverse-proxy /api to the Node.js backend. In that setup API_ORIGIN stays blank.
 *
 * When the API is hosted on a different HTTPS origin, set it here, for example:
 *   window.APP_CONFIG.API_ORIGIN = 'https://api.example.gov.ph';
 */
window.APP_CONFIG = window.APP_CONFIG || {};
// Production uses the same frontend origin and lets Vercel proxy /api to the
// backend. This avoids mobile/VPN DNS and cross-origin failures while keeping
// localhost development on the explicit API origin defined in api.js.
const defaultApiOrigin = '';
window.APP_CONFIG.API_ORIGIN = String(window.APP_CONFIG.API_ORIGIN || defaultApiOrigin).replace(/\/$/, '');
