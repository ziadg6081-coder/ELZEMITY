'use strict';
const { ensureDatabase, migrate } = require('./lib');
(async () => {
  console.log('Running migrations...');
  await ensureDatabase();
  await migrate();
})().catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
