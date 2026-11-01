'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'); const path = require('path');
const h = require('./helpers'); const { runBackup } = require('../scripts/backup'); const { restore } = require('../scripts/restore'); const { verifyBackup } = require('../scripts/backup-lib');
const mysql = require('mysql2/promise'); let app, bk;
test.before(async () => { fs.rmSync(h.config.backup.dir, { recursive: true, force: true }); await h.resetDb(); app = h.app(); const c = await h.placeOrder(app, h.customerBody()); assert.equal(c.status, 201); });
test.after(async () => { const c = await mysql.createConnection({ host: h.config.db.host, port: h.config.db.port, user: h.config.db.user, password: h.config.db.password }); await c.query('DROP DATABASE IF EXISTS oriantal_restore_check'); await c.end(); await h.db.pool.end(); });

test('backup runs, is encrypted (no plaintext SQL), checksummed and recorded as verified', async () => {
  bk = await runBackup(); const raw = fs.readFileSync(bk.file);
  assert.ok(!raw.includes('CREATE TABLE') && !raw.includes('Mona Ali')); assert.equal(raw.subarray(0, 4).toString(), 'OPB1'); assert.ok(fs.existsSync(`${bk.file}.sha256`));
  const [r] = await h.db.query("SELECT status, verified, size_bytes FROM backup_runs ORDER BY id DESC LIMIT 1"); assert.equal(r.status, 'success'); assert.equal(r.verified, 1); assert.ok(r.size_bytes > 1000);
  assert.ok((await verifyBackup(bk.file)).tables >= 19);
});
test('corrupted or truncated backups are detected', async () => {
  const bad = path.join(h.config.backup.dir, 'tampered.sql.gz.bad'); const buf = fs.readFileSync(bk.file); buf[200] ^= 0xff; fs.writeFileSync(bad, buf);
  await assert.rejects(verifyBackup(bad)); fs.writeFileSync(bad, buf.subarray(0, 100)); await assert.rejects(verifyBackup(bad));
  fs.writeFileSync(bad, buf.subarray(0, buf.length - 200)); await assert.rejects(verifyBackup(bad));
});
test('wrong encryption key cannot read the backup', async () => {
  const cfg = require('../server/config'); const old = cfg.backup.keyHex; cfg.backup.keyHex = 'b'.repeat(64);
  try { await assert.rejects(verifyBackup(bk.file)); } finally { cfg.backup.keyHex = old; }
});
test('restore into a SEPARATE database reproduces data and passes integrity checks', async () => {
  const r = await restore(bk.file, 'oriantal_restore_check');
  assert.equal(r.counts.orders, 1); assert.equal(r.counts.order_items, 1); assert.equal(r.counts.products, 8); assert.deepEqual(r.problems, []);
  const c = await mysql.createConnection({ host: h.config.db.host, port: h.config.db.port, user: h.config.db.user, password: h.config.db.password, database: 'oriantal_restore_check' });
  const [[o]] = await c.query('SELECT grand_total FROM orders'); assert.equal(o.grand_total, '1500.00');
  const [fk] = await c.query("SELECT COUNT(*) n FROM information_schema.table_constraints WHERE table_schema='oriantal_restore_check' AND constraint_type='FOREIGN KEY'"); assert.ok(fk[0].n >= 10); await c.end();
});
test('restore refuses to overwrite the live database', async () => { await assert.rejects(restore(bk.file, h.config.db.database), /Refusing/); });
test('a failing backup is recorded as failed and leaves no new backup file (bad mysqldump)', async () => {
  const list = () => fs.readdirSync(h.config.backup.dir).filter((f) => f.endsWith('.sql.gz.enc')).sort();
  const before = list(); process.env.MYSQLDUMP_BIN = '/nonexistent/mysqldump';
  try { await assert.rejects(runBackup()); } finally { delete process.env.MYSQLDUMP_BIN; }
  const [r] = await h.db.query("SELECT status, error FROM backup_runs ORDER BY id DESC LIMIT 1"); assert.equal(r.status, 'failed'); assert.ok(r.error);
  assert.deepEqual(list(), before);
});
test('admin system status reports stale/missing backups honestly', async () => {
  const adm = await h.login(app, 'admin'); let s = (await adm.agent.get('/api/admin/system')).body; assert.equal(s.backupStale, false);
  await h.db.query("UPDATE backup_runs SET finished_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 3 DAY)"); s = (await adm.agent.get('/api/admin/system')).body; assert.equal(s.backupStale, true);
});
