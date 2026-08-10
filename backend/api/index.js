// REMOVED_HOST Functions entrypoint. The Express app does not open a listening socket
// when imported, which lets REMOVED_HOST manage the request lifecycle.
module.exports = require('../server');
