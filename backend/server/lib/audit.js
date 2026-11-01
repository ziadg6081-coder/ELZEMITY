'use strict';
const db = require('./db');
const logger = require('./logger');

const SENSITIVE = /pass(word)?|token|secret|cookie|authorization|csrf/i;
function scrub(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(scrub);
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = SENSITIVE.test(k) ? '[redacted]' : scrub(v);
  return out;
}

/** Write an audit row. Pass `conn` to make it part of the caller's transaction. */
async function audit(req, action, entityType, entityId, details, conn) {
  const params = [
    req?.user?.id ?? null, action, entityType ?? null, entityId === undefined || entityId === null ? null : String(entityId),
    details ? JSON.stringify(scrub(details)) : null, req?.ip ?? null, req?.id ?? null,
  ];
  const sql = 'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip, request_id) VALUES (?,?,?,?,?,?,?)';
  try {
    if (conn) await conn.execute(sql, params); else await db.query(sql, params);
  } catch (err) {
    logger.error('audit write failed', { action, message: err.message });
    if (conn) throw err; // inside a transaction: a missing audit row must roll the change back
  }
}
module.exports = { audit };
