'use strict';
const { Server } = require('socket.io');
const { parseCookie } = require('cookie');
const db = require('./lib/db');
const config = require('./config');
const logger = require('./lib/logger');
const realtime = require('./lib/realtime');
const { resolveSession, safeEqual } = require('./middleware/auth');

/**
 * Socket.IO layer. It is a NOTIFICATION channel only - MySQL stays the source of truth.
 * Clients must re-fetch data via the REST API after receiving an event (and after every reconnect).
 */
function attachSocketIO(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: config.appOrigins, credentials: true },
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      if (!origin) return cb(null, true); // non-browser clients (cookies still required for staff rooms)
      const hostOrigin = `${config.isProd ? 'https' : 'http'}://${req.headers.host}`;
      cb(null, config.appOrigins.includes(origin) || origin === hostOrigin);
    },
    maxHttpBufferSize: 10 * 1024,
    pingInterval: 25000, pingTimeout: 20000,
    serveClient: true,
  });

  // Authenticate during the handshake using the HttpOnly session cookie. Guests are allowed (public room only).
  io.use(async (socket, next) => {
    try {
      const cookies = parseCookie(socket.handshake.headers.cookie || '');
      const resolved = await resolveSession(cookies[config.session.cookieName]);
      socket.data.user = resolved?.user || null;
      next();
    } catch (e) { logger.error('socket auth error', { message: e.message }); next(new Error('AUTH_ERROR')); }
  });

  io.on('connection', (socket) => {
    const u = socket.data.user;
    socket.join('public');
    if (u) {
      socket.join(`user:${u.id}`);
      const p = new Set(u.permissions);
      if (p.has('orders.view')) socket.join('staff:orders');
      if (p.has('shipping_payments.review')) socket.join('staff:payments');
      if (p.has('inventory.manage') || p.has('products.manage')) socket.join('staff:inventory');
      if (p.has('newsletter.manage')) socket.join('staff:newsletter');
    }
    let subs = 0;
    // Customers follow ONE order using its unguessable tracking token; they can never join another customer's room.
    socket.on('order:subscribe', async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        if (subs >= 10) return reply({ ok: false, error: 'LIMIT' });
        const { orderNumber, token } = payload || {};
        if (typeof orderNumber !== 'string' || typeof token !== 'string' || !/^OP-\d{6}-[A-Z0-9]{6}$/.test(orderNumber) || !/^[a-f0-9]{32}$/.test(token)) return reply({ ok: false, error: 'BAD_REQUEST' });
        const [o] = await db.query('SELECT public_token FROM orders WHERE order_number = ?', [orderNumber]);
        if (!o || !safeEqual(o.public_token, token)) { logger.security('socket order subscribe denied', { ip: socket.handshake.address }); return reply({ ok: false, error: 'NOT_FOUND' }); }
        subs++; socket.join(`order:${orderNumber}`);
        return reply({ ok: true });
      } catch (e) { logger.error('socket subscribe failed', { message: e.message }); return reply({ ok: false, error: 'SERVER' }); }
    });
    socket.on('error', (e) => logger.error('socket error', { message: e.message }));
  });

  realtime.setIO(io);
  return io;
}
module.exports = { attachSocketIO };
