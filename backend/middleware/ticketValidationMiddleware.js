const { sendError } = require('../utils/apiResponse');

// Keep the optional driver's-license rule consistent with Search Violator.
// A license may be omitted when unavailable, but a supplied value must be useful for repeat-offender search.
const validateTicketInput = (req, res, next) => {
    const license = String(req.body?.driver_license_number || '').trim().toUpperCase();

    if (license && license.length < 5) {
        return sendError(res,
            'Driver license number must contain at least 5 characters, or be left blank when unavailable.',
            { statusCode: 400, errorCode: 'INVALID_DRIVER_LICENSE' }
        );
    }

    if (license.length > 30) {
        return sendError(res,
            'Driver license number exceeds the allowed length.',
            { statusCode: 400, errorCode: 'INVALID_DRIVER_LICENSE' }
        );
    }

    req.body.driver_license_number = license || null;
    return next();
};

module.exports = { validateTicketInput };
