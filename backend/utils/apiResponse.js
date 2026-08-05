/**
 * apiResponse.js
 * Standardized JSON response helpers for all API endpoints.
 */

/**
 * Send a successful JSON response.
 * @param {object} res - Express response object
 * @param {string} message - Human-readable success message
 * @param {*} data - Primary payload (array or object)
 * @param {object} [options] - Optional extra fields
 * @param {number} [options.statusCode=200] - HTTP status code
 * @param {object} [options.pagination] - Pagination metadata
 * @param {object} [options.legacy] - Legacy response shape fields (backwards compat)
 */
exports.sendSuccess = (res, message, data = null, options = {}) => {
    const { statusCode = 200, pagination = null, legacy = {} } = options;

    const payload = {
        success: true,
        message,
        data,
        ...(pagination ? { pagination } : {}),
        ...legacy
    };

    return res.status(statusCode).json(payload);
};

/**
 * Send an error JSON response.
 * @param {object} res - Express response object
 * @param {string} message - Human-readable error message
 * @param {object} [options]
 * @param {number} [options.statusCode=400] - HTTP status code
 * @param {string} [options.errorCode] - Machine-readable error code
 */
exports.sendError = (res, message, options = {}) => {
    const { statusCode = 400, errorCode = 'ERROR' } = options;

    return res.status(statusCode).json({
        success: false,
        message,
        errorCode
    });
};
