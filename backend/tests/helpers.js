'use strict';
process.env.NODE_ENV = 'test';
process.env.BACKUP_ENCRYPTION_KEY = process.env.BACKUP_ENCRYPTION_KEY || 'a'.repeat(64);
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || 'tests/.tmp/uploads';
process.env.BACKUP_DIR = process.env.BACKUP_DIR || 'tests/.tmp/backups';
const crypto = require('crypto');
const request = require('supertest');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const config = require('../server/config');
const { migrate } = require('../scripts/lib');
const { seed } = require('../scripts/seed');
const { createApp } = require('../server/app');
const db = require('../server/lib/db');

const PW = 'Sup3r-Secret-Pw!';
const USERS = { admin: 'admin@test.com', orders: 'orders@test.com', inventory: 'inventory@test.com', customer: 'customer@test.com', disabled: 'disabled@test.com' };
const ROLE = { admin: 'admin', orders: 'order_manager', inventory: 'inventory_manager', customer: 'customer', disabled: 'customer' };

async function resetDb({ stock = 25 } = {}) {
  const c = await mysql.createConnection({ host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password, multipleStatements: true });
  await c.query(`DROP DATABASE IF EXISTS \`${config.db.database}\``); await c.query(`CREATE DATABASE \`${config.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await c.end();
  await migrate({ log: () => {} });
  const conn = await mysql.createConnection({ host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password, database: config.db.database });
  await seed(conn, stock);
  const hash = await bcrypt.hash(PW, 4);
  for (const [k, email] of Object.entries(USERS)) {
    await conn.query('INSERT INTO users (email, name, password_hash, role_id, is_active) VALUES (?,?,?, (SELECT id FROM roles WHERE name=?), ?)', [email, k, hash, ROLE[k], k === 'disabled' ? 0 : 1]);
  }
  await conn.end();
}
const app = () => createApp();
async function login(application, who) {
  const agent = request.agent(application);
  const r = await agent.post('/api/auth/login').send({ email: USERS[who], password: PW });
  if (r.status !== 200) throw new Error(`login failed for ${who}: ${r.status} ${JSON.stringify(r.body)}`);
  return { agent, csrf: r.body.csrfToken, user: r.body.user };
}
const post = (s, path, body) => s.agent.post(path).set('X-CSRF-Token', s.csrf).send(body);
const patch = (s, path, body) => s.agent.patch(path).set('X-CSRF-Token', s.csrf).send(body);
const del = (s, path) => s.agent.delete(path).set('X-CSRF-Token', s.csrf);

const customerBody = (over = {}) => ({ name: 'Mona Ali', phone: '01012345678', governorate: 'Cairo', city: 'Nasr City', address: '12 Street, Building 4', items: [{ productId: 1, quantity: 1 }], ...over });
const newKey = () => crypto.randomBytes(16).toString('hex');
const placeOrder = (application, body = customerBody(), key = newKey()) => request(application).post('/api/orders').set('Idempotency-Key', key).send(body);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const stockOf = async (id) => Number((await db.query('SELECT stock_quantity s FROM products WHERE id=?', [id]))[0].s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function submitReceipt(application, order, extra = {}) {
  return request(application).post(`/api/orders/${order.orderNumber}/shipping-payment`).set('X-Order-Token', order.trackingToken)
    .field('reference', extra.reference || 'IP123456').attach('receipt', extra.file || PNG, { filename: extra.filename || 'r.png' });
}
module.exports = { resetDb, app, login, post, patch, del, customerBody, newKey, placeOrder, PNG, stockOf, sleep, submitReceipt, PW, USERS, db, config, request };
