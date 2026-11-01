'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const config = require('./config');
const db = require('./lib/db');
const logger = require('./lib/logger');
const core = require('./middleware/core');
const limits = require('./middleware/limits');
const { attachUser, csrfProtect } = require('./middleware/auth');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy !== false) app.set('trust proxy', config.trustProxy);

  const wsOrigins = config.appOrigins.map((o) => o.replace(/^http/, 'ws'));
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ['https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https://images.unsplash.com', 'https:'],
        connectSrc: ["'self'", ...wsOrigins],
        objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"],
        ...(config.isProd ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    hsts: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));
  app.use(core.requestId);
  app.use(core.requestLogger);
  app.use(compression());

  app.use('/api', cors({
    origin: (origin, cb) => (!origin || config.appOrigins.includes(origin) ? cb(null, true) : cb(new Error('CORS_NOT_ALLOWED'))),
    credentials: true, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'], allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key', 'X-Order-Token', 'X-Request-Id'],
  }));
  app.use('/api', limits.api);
  app.use('/api', express.json({ limit: '50kb', strict: true }));
  app.use('/api', cookieParser());
  app.use('/api', core.requireJson);
  app.use('/api', attachUser);
  app.use('/api', csrfProtect);

  // Health: never leaks internals. 503 when the database is unreachable (no fake "OK").
  app.get('/api/health', async (req, res) => {
    try { await db.ping(); res.json({ status: 'ok', db: 'up', time: new Date().toISOString() }); }
    catch (e) { logger.error('health check: database down', { message: e.message }); res.status(503).json({ status: 'error', db: 'down' }); }
  });

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api', require('./routes/public'));

  // Product images uploaded from the admin panel (random names, images only, never executable)
  app.use('/media/products', express.static(require('./middleware/upload').PRODUCT_DIR, { maxAge: '7d', immutable: true, index: false, dotfiles: 'ignore', setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff') }));

  // Static storefront + admin panel (uploads/ and backups/ are never served).
  app.use(express.static(config.frontendDir, {
    maxAge: config.isProd ? '1h' : 0, index: 'index.html', dotfiles: 'ignore',
    setHeaders: (res, file) => { if (file.endsWith('admin.html')) res.set('X-Robots-Tag', 'noindex, nofollow'); },
  }));
  app.get('/admin', (req, res) => res.sendFile(path.join(config.frontendDir, 'admin.html')));

  app.use(core.notFoundHandler);
  app.use(core.errorHandler);
  return app;
}
module.exports = { createApp };
