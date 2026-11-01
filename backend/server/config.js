'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const env = process.env;
const NODE_ENV = env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';

function required(name) {
  const v = env[name];
  if (v === undefined || v === '') throw new Error(`Missing required environment variable: ${name}`);
  return v;
}
const int = (name, def) => {
  const v = env[name];
  if (v === undefined || v === '') return def;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`Environment variable ${name} must be an integer`);
  return n;
};
const list = (name, def = []) => (env[name] ? env[name].split(',').map((s) => s.trim()).filter(Boolean) : def);

const root = path.join(__dirname, '..'); // = backend/
const frontendDir = path.resolve(root, env.FRONTEND_DIR || '../frontend');
const port = int('PORT', 3000);
const appOrigins = list('APP_ORIGINS', [`http://localhost:${port}`, `http://127.0.0.1:${port}`]);

const config = {
  NODE_ENV, isProd, isTest, root, frontendDir,
  port,
  appOrigins,
  trustProxy: env.TRUST_PROXY === undefined ? (isProd ? 1 : false) : (/^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY === 'true'),
  db: {
    host: env.DB_HOST || '127.0.0.1',
    port: int('DB_PORT', 3306),
    database: isTest ? (env.DB_TEST_NAME || `${env.DB_NAME || 'oriantal_perfumes'}_test`) : required('DB_NAME'),
    user: required('DB_USER'),
    password: env.DB_PASSWORD || '',
    connectionLimit: int('DB_POOL_SIZE', 10),
    ssl: env.DB_SSL === 'true' ? { rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED !== 'false', ...(env.DB_SSL_CA ? { ca: require('fs').readFileSync(env.DB_SSL_CA, 'utf8') } : {}) } : undefined,
  },
  session: {
    cookieName: 'op_session',
    ttlHours: int('SESSION_TTL_HOURS', 12),
  },
  upload: {
    dir: path.resolve(root, env.UPLOAD_DIR || 'uploads'),
    maxBytes: int('UPLOAD_MAX_BYTES', 5 * 1024 * 1024),
  },
  logDir: path.resolve(root, env.LOG_DIR || 'logs'),
  logLevel: env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  backup: {
    dir: path.resolve(root, env.BACKUP_DIR || 'backups'),
    offsiteDir: env.BACKUP_OFFSITE_DIR ? path.resolve(env.BACKUP_OFFSITE_DIR) : '',
    keep: int('BACKUP_KEEP', 14),
    keyHex: env.BACKUP_ENCRYPTION_KEY || '',
  },
  passwordReset: {
    origin: env.PUBLIC_SITE_ORIGIN || `http://localhost:${port}`,
    smtpHost: env.SMTP_HOST || '',
    smtpPort: int('SMTP_PORT', 587),
    smtpSecure: env.SMTP_SECURE === 'true',
    smtpUser: env.SMTP_USER || '',
    smtpPassword: env.SMTP_PASSWORD || '',
    from: env.SMTP_FROM || '',
  },
  loginMaxFailures: int('LOGIN_MAX_FAILURES', 5),
  loginLockMinutes: int('LOGIN_LOCK_MINUTES', 15),
  bcryptCost: int('BCRYPT_COST', isTest ? 4 : 12),
  expirySweepSeconds: int('EXPIRY_SWEEP_SECONDS', 300),
  disableRateLimit: isTest && env.TEST_ENABLE_RATE_LIMIT !== 'true',
};

if (isProd) {
  if (config.passwordReset.smtpHost && (!config.passwordReset.from || !config.passwordReset.smtpUser || !config.passwordReset.smtpPassword || !config.passwordReset.origin.startsWith('https://'))) throw new Error('SMTP_FROM, SMTP_USER, SMTP_PASSWORD and HTTPS PUBLIC_SITE_ORIGIN are required for production password reset');
  if (!config.db.password) throw new Error('DB_PASSWORD must be set in production');
  if (config.db.user === 'root') throw new Error('Do not run the application as the MySQL root user in production. Create a dedicated user (see database/00_create_db_and_user.sql).');
  if (config.appOrigins.some((o) => !o.startsWith('https://'))) throw new Error('APP_ORIGINS must be https:// origins in production');
}

module.exports = config;
