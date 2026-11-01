'use strict';
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const config = require('../config');
const { AppError } = require('../lib/errors');

const parser = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.upload.maxBytes, files: 1, fields: 10, fieldSize: 2000 } });
const receiptUpload = parser.single('receipt');
const imageUpload = parser.single('image');
const PRODUCT_DIR = path.join(config.upload.dir, 'products'); // the ONLY uploads subfolder that is publicly served (/media/products)

/** Detect the real type from magic bytes - never trust the client-supplied mimetype or filename. */
function sniffImage(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.length > 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

async function saveReceipt(file) {
  const kind = sniffImage(file.buffer);
  if (!kind) throw new AppError(415, 'UNSUPPORTED_FILE', 'Only JPEG, PNG or WebP images are allowed');
  await fs.mkdir(config.upload.dir, { recursive: true, mode: 0o700 });
  const name = `${crypto.randomBytes(16).toString('hex')}.${kind.ext}`; // random name: client filename is discarded
  await fs.writeFile(path.join(config.upload.dir, name), file.buffer, { mode: 0o600, flag: 'wx' });
  return { name, mime: kind.mime };
}
const removeReceipt = (name) => fs.unlink(path.join(config.upload.dir, path.basename(name))).catch(() => {});

async function saveProductImage(file) {
  const kind = sniffImage(file.buffer);
  if (!kind) throw new AppError(415, 'UNSUPPORTED_FILE', 'Only JPEG, PNG or WebP images are allowed');
  await fs.mkdir(PRODUCT_DIR, { recursive: true, mode: 0o755 });
  const name = `${crypto.randomBytes(16).toString('hex')}.${kind.ext}`;
  await fs.writeFile(path.join(PRODUCT_DIR, name), file.buffer, { mode: 0o644, flag: 'wx' });
  return { name, url: `/media/products/${name}` };
}
const LOCAL_IMG = /^\/media\/products\/[a-f0-9]{32}\.(jpg|png|webp)$/;
const removeProductImage = (url) => (LOCAL_IMG.test(url || '') ? fs.unlink(path.join(PRODUCT_DIR, path.basename(url))).catch(() => {}) : Promise.resolve());

module.exports = { imageUpload, saveProductImage, removeProductImage, LOCAL_IMG, PRODUCT_DIR, receiptUpload, saveReceipt, removeReceipt, sniffImage };
