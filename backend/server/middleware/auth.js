'use strict';
const crypto = require('crypto');
const db = require('../lib/db');
const config = require('../config');
const { unauthorized, forbidden, AppError } = require('../lib/errors');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const safeEqual = (a, b) => {
  const A = Buffer.from(String(a)); const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};

async function createSession(userId, req, conn) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('hex');
  const sql = 'INSERT INTO sessions (token_hash, user_id, csrf_token, ip, user_agent, expires_at) VALUES (?,?,?,?,?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? HOUR))';
  const params = [sha256(token), userId, csrf, req.ip || null, (req.get('user-agent') || '').slice(0, 255), config.session.ttlHours];
  if (conn) await conn.execute(sql, params); else await db.query(sql, params);
  return { token, csrf };
}

function cookieOptions() {
  return { httpOnly: true, secure: config.isProd, sameSite: 'lax', path: '/', maxAge: config.session.ttlHours * 3600 * 1000 };
}
const setSessionCookie = (res, token) => res.cookie(config.session.cookieName, token, cookieOptions());
const clearSessionCookie = (res) => res.clearCookie(config.session.cookieName, { ...cookieOptions(), maxAge: undefined });

/** Resolve a raw session token to { user, session } or null. Used by HTTP and Socket.IO. */
async function resolveSession(token) {
  if (!token || typeof token !== 'string' || token.length > 100) return null;
  const rows = await db.query(
    `SELECT s.id AS session_id, s.csrf_token, u.id, u.email, u.name, u.is_active, r.name AS role
       FROM sessions s JOIN users u ON u.id = s.user_id JOIN roles r ON r.id = u.role_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP()`, [sha256(token)]);
  const row = rows[0];
  if (!row || !row.is_active) return null;
  const perms = await db.query(
    `SELECT p.code FROM users u JOIN role_permissions rp ON rp.role_id = u.role_id JOIN permissions p ON p.id = rp.permission_id WHERE u.id = ?`, [row.id]);
  return {
    user: { id: Number(row.id), email: row.email, name: row.name, role: row.role, permissions: perms.map((p) => p.code) },
    session: { id: Number(row.session_id), csrf: row.csrf_token },
  };
}

async function attachUser(req, res, next) {
  try {
    const token = req.cookies?.[config.session.cookieName];
    if (token) {
      const resolved = await resolveSession(token);
      if (resolved) { req.user = resolved.user; req.session = resolved.session; }
    }
    next();
  } catch (e) { next(e); }
}

/** CSRF: any state-changing request that carries a session cookie must carry the matching X-CSRF-Token, and a trusted Origin. */
function csrfProtect(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    const sameHost = origin === `${req.protocol}://${req.get('host')}`;
    if (!sameHost && !config.appOrigins.includes(origin)) return next(new AppError(403, 'CSRF_ORIGIN', 'Untrusted origin'));
  }
  if (req.session) {
    const sent = req.get('x-csrf-token');
    if (!sent || !safeEqual(sent, req.session.csrf)) return next(new AppError(403, 'CSRF', 'Missing or invalid CSRF token'));
  }
  return next();
}

const requireAuth = (req, res, next) => (req.user ? next() : next(unauthorized()));
const requireStaff = (req, res, next) => {
  if (!req.user) return next(unauthorized());
  if (req.user.role === 'customer') return next(forbidden());
  return next();
};
/** Requires at least ONE of the listed permissions. */
const requirePermission = (...codes) => (req, res, next) => {
  if (!req.user) return next(unauthorized());
  if (!codes.some((c) => req.user.permissions.includes(c))) return next(forbidden());
  return next();
};
const hasPerm = (user, code) => !!user && user.permissions.includes(code);

module.exports = { sha256, safeEqual, createSession, setSessionCookie, clearSessionCookie, resolveSession, attachUser, csrfProtect, requireAuth, requireStaff, requirePermission, hasPerm };
