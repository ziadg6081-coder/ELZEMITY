'use strict';
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}
const badRequest = (m, d) => new AppError(400, 'BAD_REQUEST', m, d);
const unauthorized = (m = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', m);
const forbidden = (m = 'You do not have permission to perform this action') => new AppError(403, 'FORBIDDEN', m);
const notFound = (m = 'Not found') => new AppError(404, 'NOT_FOUND', m);
const conflict = (m, code = 'CONFLICT', d) => new AppError(409, code, m, d);
const unprocessable = (m, code = 'UNPROCESSABLE', d) => new AppError(422, code, m, d);
module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict, unprocessable };
