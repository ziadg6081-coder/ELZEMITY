'use strict';
const crypto = require('crypto');
const fs = require('fs');
const zlib = require('zlib');
const { Transform, PassThrough, pipeline } = require('stream');
const config = require('../server/config');

const MAGIC = Buffer.from('OPB1');
function key() {
  const k = config.backup.keyHex;
  if (!/^[0-9a-fA-F]{64}$/.test(k)) throw new Error('BACKUP_ENCRYPTION_KEY must be 64 hex characters (openssl rand -hex 32)');
  return Buffer.from(k, 'hex');
}
/** AES-256-GCM stream encryptor: [MAGIC][iv 12][ciphertext...][tag 16] */
function encryptStream() {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  let first = true;
  return new Transform({
    transform(chunk, _e, cb) { const out = c.update(chunk); cb(null, first ? (first = false, Buffer.concat([MAGIC, iv, out])) : out); },
    flush(cb) { const fin = c.final(); const tag = c.getAuthTag(); cb(null, Buffer.concat([first ? Buffer.concat([MAGIC, iv]) : Buffer.alloc(0), fin, tag])); },
  });
}
/** Returns a readable stream of the plaintext .sql. Auth tag is verified at the end (stream errors on tamper/corruption). */
function decryptToSqlStream(file) {
  const size = fs.statSync(file).size;
  if (size < 4 + 12 + 16 + 1) throw new Error('Backup file is too small / truncated');
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(16); fs.readSync(fd, head, 0, 16, 0);
  const tag = Buffer.alloc(16); fs.readSync(fd, tag, 0, 16, size - 16); fs.closeSync(fd);
  if (!head.subarray(0, 4).equals(MAGIC)) throw new Error('Not an Oriantal Perfumes backup file');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), head.subarray(4, 16)); d.setAuthTag(tag);
  const out = new PassThrough();
  // pipeline() propagates auth-tag / gzip / read errors to the consumer instead of crashing the process
  pipeline(fs.createReadStream(file, { start: 16, end: size - 17 }), d, zlib.createGunzip(), out, (err) => { if (err) out.destroy(err); });
  return out;
}
const sha256File = (file) => new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });

/** Verifies integrity + that the dump is complete (full decrypt/gunzip + markers). */
async function verifyBackup(file) {
  const expected = fs.existsSync(`${file}.sha256`) ? fs.readFileSync(`${file}.sha256`, 'utf8').split(/\s+/)[0] : null;
  const actual = await sha256File(file);
  if (expected && expected !== actual) throw new Error('SHA-256 mismatch: file is corrupted');
  let sawTables = 0; let complete = false; let tail = '';
  await new Promise((res, rej) => {
    decryptToSqlStream(file).on('data', (b) => { const s = tail + b.toString('utf8'); sawTables += (s.match(/CREATE TABLE `/g) || []).length; if (s.includes('-- Dump completed')) complete = true; tail = s.slice(-200); }).on('end', res).on('error', rej);
  });
  if (!sawTables) throw new Error('Backup contains no tables');
  if (!complete) throw new Error('Dump is incomplete (no completion marker)');
  return { sha256: actual, tables: sawTables };
}
module.exports = { encryptStream, decryptToSqlStream, sha256File, verifyBackup };
