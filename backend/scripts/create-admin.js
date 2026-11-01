'use strict';
/** Creates (or promotes) an admin account. Password is typed interactively (hidden) or via ADMIN_EMAIL / ADMIN_NAME / ADMIN_PASSWORD env vars. Never stored in files. */
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const config = require('../server/config');
const { prompt } = require('./lib');

async function createAdmin(conn, { email, name, password, role = 'admin' }) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Invalid email');
  if (!password || password.length < 10) throw new Error('Password must be at least 10 characters');
  const hash = await bcrypt.hash(password, config.bcryptCost);
  const [r] = await conn.query(
    'INSERT INTO users (email, name, password_hash, role_id) VALUES (?,?,?, (SELECT id FROM roles WHERE name = ?)) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role_id = VALUES(role_id), is_active = 1, failed_logins = 0, locked_until = NULL',
    [email.toLowerCase(), name, hash, role]);
  return r;
}
module.exports = { createAdmin };

if (require.main === module) {
  (async () => {
    const email = process.env.ADMIN_EMAIL || (await prompt('Admin email: ')).trim();
    const name = process.env.ADMIN_NAME || (await prompt('Admin name: ')).trim() || 'Store Owner';
    const password = process.env.ADMIN_PASSWORD || (await prompt('Admin password (min 10 chars, hidden): ', { hidden: true }));
    const conn = await mysql.createConnection({ host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password, database: config.db.database });
    await createAdmin(conn, { email, name, password });
    console.log(`Admin account ready: ${email}`);
    await conn.end();
  })().catch((e) => { console.error('Failed:', e.message); process.exit(1); });
}
