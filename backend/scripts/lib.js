'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const mysql = require('mysql2/promise');
const config = require('../server/config');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'database', 'migrations');

/** Connection for schema work. Uses DB_MIGRATION_USER if provided (least privilege split), else DB_USER. */
async function connect({ withDatabase = true } = {}) {
  return mysql.createConnection({
    host: config.db.host, port: config.db.port,
    user: process.env.DB_MIGRATION_USER || config.db.user,
    password: process.env.DB_MIGRATION_USER ? (process.env.DB_MIGRATION_PASSWORD || '') : config.db.password,
    database: withDatabase ? config.db.database : undefined,
    ssl: config.db.ssl, multipleStatements: true, charset: 'utf8mb4', timezone: 'Z',
  });
}

async function ensureDatabase() {
  const conn = await connect({ withDatabase: false });
  const name = config.db.database;
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error('DB_NAME may only contain letters, digits and underscore');
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.end();
}

const files = () => fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
const checksum = (text) => crypto.createHash('sha256').update(text).digest('hex');

async function migrate({ log = console.log } = {}) {
  const conn = await connect();
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(20) NOT NULL PRIMARY KEY, name VARCHAR(190) NOT NULL, checksum CHAR(64) NOT NULL, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const [applied] = await conn.query('SELECT version, checksum FROM schema_migrations');
    const done = new Map(applied.map((r) => [r.version, r.checksum]));
    let count = 0;
    for (const f of files()) {
      const version = f.split('_')[0];
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      const sum = checksum(sql);
      if (done.has(version)) {
        if (done.get(version) !== sum) throw new Error(`Migration ${f} was modified after being applied. Never edit applied migrations - add a new one.`);
        continue;
      }
      log(`  applying ${f} ...`);
      await conn.query(sql);
      await conn.query('INSERT INTO schema_migrations (version, name, checksum) VALUES (?,?,?)', [version, f, sum]);
      count++;
    }
    log(count ? `  ${count} migration(s) applied.` : '  schema already up to date.');
    return count;
  } finally { await conn.end(); }
}

function prompt(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); else rl.output.write(''); };
    }
    rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a); });
  });
}
module.exports = { connect, ensureDatabase, migrate, prompt, files, MIGRATIONS_DIR };
