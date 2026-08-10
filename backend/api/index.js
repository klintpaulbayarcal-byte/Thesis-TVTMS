// Vercel Functions entrypoint. The Express app does not open a listening socket
// when imported, which lets Vercel manage the request lifecycle.
module.exports = require('../server');
