'use strict';
const http = require('http');
const config = require('./config');
const logger = require('./lib/logger');
const db = require('./lib/db');
const { createApp } = require('./app');
const { attachSocketIO } = require('./realtime');
const orders = require('./services/orders');

async function main() {
  await db.ping(); // fail fast with a clear error if MySQL is unreachable / wrong credentials
  const [v] = await db.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'schema_migrations'");
  if (!Number(v.n)) throw new Error('Database schema is not installed. Run: npm run setup');

  const app = createApp();
  const server = http.createServer(app);
  attachSocketIO(server);
  server.listen(config.port, () => logger.info(`Elzemity listening on :${config.port} (${config.NODE_ENV})`));

  // Releases stock of orders whose shipping payment window expired. Overlap-safe: one run at a time.
  let sweeping = false;
  const sweep = async () => {
    if (sweeping) return; sweeping = true;
    try { const n = await orders.expireUnpaidOrders(); if (n) logger.info('expired unpaid orders cancelled', { count: n }); }
    catch (e) { logger.error('expiry sweep error', { message: e.message }); } finally { sweeping = false; }
  };
  const timer = setInterval(sweep, config.expirySweepSeconds * 1000); timer.unref();

  const shutdown = (sig) => {
    logger.info(`${sig} received, shutting down`);
    server.close(async () => { try { await db.pool.end(); } catch { /* ignore */ } process.exit(0); });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (e) => logger.error('unhandledRejection', { message: e?.message, stack: e?.stack }));
}
main().catch((e) => { console.error('Startup failed:', e.message); logger.error('startup failed', { message: e.message }); process.exit(1); });
