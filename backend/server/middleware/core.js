'use strict';
const crypto = require('crypto');
const logger = require('../lib/logger');
const { AppError } = require('../lib/errors');
const config = require('../config');

function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.set('X-Request-Id', req.id);
  next();
}

function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    // NOTE: only the path is logged (no query string, headers, cookies or body) so secrets can never leak into logs.
    logger.log(level, 'http', { requestId: req.id, method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, ms: Math.round(ms), user: req.user?.id });
    if (res.statusCode === 401 || res.statusCode === 403) {
      logger.security('access denied', { requestId: req.id, method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, ip: req.ip, user: req.user?.id });
    }
  });
  next();
}

function notFoundHandler(req, res, next) {
  if (req.path.startsWith('/api/')) return next(new AppError(404, 'NOT_FOUND', 'Endpoint not found'));
  return res.status(404).type('text/plain').send('Not found');
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return;
  let status = 500; let code = 'INTERNAL'; let message = 'Something went wrong. Please try again.'; let details;
  if (err instanceof AppError) { status = err.status; code = err.code; message = err.message; details = err.details; }
  else if (err?.type === 'entity.too.large') { status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'Request body is too large'; }
  else if (err?.type === 'entity.parse.failed') { status = 400; code = 'INVALID_JSON'; message = 'Malformed JSON body'; }
  else if (err?.name === 'MulterError') { status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400; code = 'UPLOAD_ERROR'; message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : 'Invalid upload'; }
  else if (err?.message === 'CORS_NOT_ALLOWED') { status = 403; code = 'CORS'; message = 'Origin not allowed'; }

  if (status >= 500) {
    // Internal details go to logs only - never to the client.
    logger.error('unhandled error', { requestId: req.id, method: req.method, path: req.path, message: err?.message, code: err?.code, stack: config.isProd ? undefined : err?.stack });
  }
  const body = { error: { code, message, requestId: req.id } };
  if (details && status < 500) body.error.details = details;
  res.status(status).json(body);
}

/** Zod validation helper: validate(schema, 'body'|'query'|'params'). Replaces the request part with the parsed (stripped) value. */
function validate(schema, part = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
      return next(new AppError(400, 'VALIDATION_ERROR', 'Invalid request data', details));
    }
    req[part] = result.data;
    return next();
  };
}

const requireJson = (req, res, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.headers['content-length'] !== '0' && req.get('content-length') !== undefined) {
    const ct = req.get('content-type') || '';
    if (!ct.startsWith('application/json') && !ct.startsWith('multipart/form-data')) {
      return next(new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json'));
    }
  }
  return next();
};

module.exports = { requestId, requestLogger, notFoundHandler, errorHandler, validate, requireJson };
