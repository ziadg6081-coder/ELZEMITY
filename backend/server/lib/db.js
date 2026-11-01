'use strict';
const mysql = require('mysql2/promise');
const config = require('../config');
const logger = require('./logger');

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  ssl: config.db.ssl,
  waitForConnections: true,
  connectionLimit: config.db.connectionLimit,
  queueLimit: 100,
  charset: 'utf8mb4',
  timezone: 'Z',
  decimalNumbers: false, // keep DECIMAL as exact strings
  multipleStatements: false, // defence in depth against stacked-query injection
});

// Every connection works in UTC so CURRENT_TIMESTAMP / UTC_TIMESTAMP() are consistent.
pool.pool.on('connection', (c) => { c.query("SET time_zone = '+00:00'"); });

/** Parameterized query (server-side prepared statements via execute). */
async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/** Run fn(conn) inside a transaction. Commits on success, rolls back on any throw. */
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch (rbErr) { logger.error('rollback failed', { message: rbErr.message }); }
    throw err;
  } finally {
    conn.release();
  }
}
const exec = async (conn, sql, params = []) => { const [r] = await conn.execute(sql, params); return r; };

async function ping() { await pool.query('SELECT 1'); }

module.exports = { pool, query, withTransaction, exec, ping };
