'use strict';
/** One-shot local setup: create DB -> run migrations -> load sample products -> create admin. Safe to re-run. */
const mysql = require('mysql2/promise');
const config = require('../server/config');
const { ensureDatabase, migrate, prompt } = require('./lib');
const { seed } = require('./seed');
const { createAdmin } = require('./create-admin');

(async () => {
  console.log(`\n== Oriantal Perfumes setup (database: ${config.db.database}) ==`);
  await ensureDatabase();
  await migrate();
  const conn = await mysql.createConnection({ host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password, database: config.db.database });
  const [[{ n }]] = await conn.query("SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'admin'");
  if (n === 0) {
    console.log('\nNo admin account yet. Create one now:');
    const email = process.env.ADMIN_EMAIL || (await prompt('Admin email: ')).trim();
    const name = process.env.ADMIN_NAME || (await prompt('Admin name: ')).trim() || 'Store Owner';
    const password = process.env.ADMIN_PASSWORD || (await prompt('Admin password (min 10 chars, hidden): ', { hidden: true }));
    await createAdmin(conn, { email, name, password });
    console.log('Admin created.');
  } else console.log('Admin account already exists.');
  if (process.env.SEED !== 'no') {
    const ans = process.env.SEED === 'yes' ? 'y' : (await prompt('\nLoad the 8 SAMPLE products? (y/N): ')).trim().toLowerCase();
    if (ans === 'y') console.log(`Seeded ${await seed(conn)} sample products.`);
  }
  await conn.end();
  console.log('\nDone. Start the store with:  npm start   ->  http://localhost:' + config.port + '   (admin: /admin)\n');
})().catch((e) => { console.error('Setup failed:', e.message); process.exit(1); });
