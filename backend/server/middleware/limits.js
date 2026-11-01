'use strict';
const rateLimit = require('express-rate-limit');
const config = require('../config');
const logger = require('../lib/logger');

const make = (opts) => (config.disableRateLimit
  ? (req, res, next) => next()
  : rateLimit({
    standardHeaders: true, legacyHeaders: false,
    handler: (req, res) => {
      logger.security('rate limit hit', { requestId: req.id, path: req.path, ip: req.ip });
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait and try again.', requestId: req.id } });
    },
    ...opts,
  }));

module.exports = {
  api: make({ windowMs: 60 * 1000, limit: 300 }),
  login: make({ windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true }),
  passwordReset: make({ windowMs: 60 * 60 * 1000, limit: 5 }),
  resetConfirm: make({ windowMs: 15 * 60 * 1000, limit: 10 }),
  register: make({ windowMs: 60 * 60 * 1000, limit: 10 }),
  createOrder: make({ windowMs: 10 * 60 * 1000, limit: 15 }),
  upload: make({ windowMs: 60 * 60 * 1000, limit: 20 }),
  lookup: make({ windowMs: 10 * 60 * 1000, limit: 60 }),
};
