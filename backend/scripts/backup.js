'use strict';
/** Encrypted, verified MySQL backup. Run from cron/systemd (see BACKUP_RESTORE.md). Exit code != 0 on ANY failure. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const mysql = require('mysql2/promise');
const config = require('../server/config');
const { encryptStream, verifyBackup } = require('./backup-lib');

const stamp = () => `${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z')}-${require('crypto').randomBytes(3).toString('hex')}`; // unique: a new backup can never overwrite (or, on failure, delete) an older one

async function runBackup() {
  fs.mkdirSync(config.backup.dir, { recursive: true, mode: 0o700 });
  const conn = await mysql.createConnection({ host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password, database: config.db.database });
  const [ins] = await conn.query("INSERT INTO backup_runs (started_at, status) VALUES (UTC_TIMESTAMP(), 'running')");
  const runId = ins.insertId;
  const name = `${config.db.database}-${stamp()}.sql.gz.enc`;
  const file = path.join(config.backup.dir, name);
  try {
    const dump = spawn(process.env.MYSQLDUMP_BIN || 'mysqldump', ['-h', config.db.host, '-P', String(config.db.port), '-u', config.db.user, '--single-transaction', '--routines', '--triggers', '--no-tablespaces', '--default-character-set=utf8mb4', '--set-gtid-purged=OFF', config.db.database],
      { env: { ...process.env, MYSQL_PWD: config.db.password }, stdio: ['ignore', 'pipe', 'pipe'] }); // password via env, never argv
    let stderr = ''; dump.stderr.on('data', (d) => { stderr += d; });
    const exited = new Promise((res, rej) => { dump.on('error', rej); dump.on('close', (code) => (code === 0 ? res() : rej(new Error(`mysqldump exited with ${code}: ${stderr.trim().slice(0, 300)}`)))); });
    await Promise.all([pipeline(dump.stdout, zlib.createGzip(), encryptStream(), fs.createWriteStream(file, { mode: 0o600, flags: 'wx' })), exited]);

    const v = await verifyBackup(file);               // never trust a file just because it exists
    fs.writeFileSync(`${file}.sha256`, `${v.sha256}  ${name}\n`);
    let offsite = 0;
    if (config.backup.offsiteDir) {
      fs.mkdirSync(config.backup.offsiteDir, { recursive: true });
      const dest = path.join(config.backup.offsiteDir, name);
      fs.copyFileSync(file, dest); fs.copyFileSync(`${file}.sha256`, `${dest}.sha256`);
      await verifyBackup(dest); offsite = 1;           // verify the off-site copy too
    }
    const size = fs.statSync(file).size;
    await conn.query("UPDATE backup_runs SET status='success', finished_at=UTC_TIMESTAMP(), file_name=?, size_bytes=?, sha256=?, verified=1, offsite_copied=? WHERE id=?", [name, size, v.sha256, offsite, runId]);
    // Retention: only after a NEW verified backup exists, prune the oldest local files beyond BACKUP_KEEP.
    const all = fs.readdirSync(config.backup.dir).filter((f) => f.endsWith('.sql.gz.enc')).sort();
    for (const old of all.slice(0, Math.max(0, all.length - config.backup.keep))) { fs.unlinkSync(path.join(config.backup.dir, old)); fs.rmSync(path.join(config.backup.dir, `${old}.sha256`), { force: true }); }
    console.log(`Backup OK: ${name} (${(size / 1024).toFixed(1)} KB, ${v.tables} tables, verified${offsite ? ', off-site copy verified' : ', NO off-site copy configured'})`);
    return { name, file, offsite: !!offsite };
  } catch (e) {
    fs.rmSync(file, { force: true });
    await conn.query("UPDATE backup_runs SET status='failed', finished_at=UTC_TIMESTAMP(), error=? WHERE id=?", [String(e.message).slice(0, 480), runId]).catch(() => {});
    throw e;
  } finally { await conn.end(); }
}
module.exports = { runBackup };
if (require.main === module) runBackup().catch((e) => { console.error('BACKUP FAILED:', e.message); process.exit(1); });
