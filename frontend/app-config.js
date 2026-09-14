/**
 * Runtime frontend configuration.
 *
 * Development and Hostinger production use the same Express origin for both
 * static pages and /api. Database credentials remain server-side.
 */
window.APP_CONFIG = window.APP_CONFIG || {};
const defaultApiOrigin = '';
window.APP_CONFIG.API_ORIGIN = String(window.APP_CONFIG.API_ORIGIN || defaultApiOrigin).replace(/\/$/, '');
