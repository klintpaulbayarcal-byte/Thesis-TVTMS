/**
 * Runtime frontend configuration.
 *
 * Hostinger serves the static frontend while the Node.js/Express API runs on
 * Vercel. Database credentials remain server-side in the API deployment.
 */
window.APP_CONFIG = window.APP_CONFIG || {};
const defaultApiOrigin = 'https://thesis-tvtms-api.vercel.app';
window.APP_CONFIG.API_ORIGIN = String(window.APP_CONFIG.API_ORIGIN || defaultApiOrigin).replace(/\/$/, '');
