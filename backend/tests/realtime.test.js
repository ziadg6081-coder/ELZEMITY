'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const http = require('http'); const { io: connect } = require('socket.io-client');
const h = require('./helpers'); const { attachSocketIO } = require('../server/realtime');
let app, server, url, om, adm; const clients = [];
test.before(async () => {
  await h.resetDb(); app = h.app(); server = http.createServer(app); attachSocketIO(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); url = `http://127.0.0.1:${server.address().port}`;
  om = await h.login(app, 'orders'); adm = await h.login(app, 'admin');
});
test.after(async () => { clients.forEach((c) => c.close()); await new Promise((r) => server.close(r)); await h.db.pool.end(); });

const cookieOf = async (who) => (await h.request(app).post('/api/auth/login').send({ email: h.USERS[who], password: h.PW })).headers['set-cookie'][0].split(';')[0];
const sock = (cookie) => new Promise((res, rej) => { const s = connect(url, { transports: ['websocket'], extraHeaders: cookie ? { cookie } : {}, reconnection: false }); clients.push(s); s.on('connect', () => res(s)); s.on('connect_error', rej); });
const collect = (s, ev) => { const got = []; s.on(ev, (p) => got.push(p)); return got; };
const base = { items: [{ productId: 1, quantity: 1 }] };

test('authorised staff receive order:created; guests and customers do not; payload is minimal', async () => {
  const staff = await sock(await cookieOf('orders')); const guest = await sock(); const cust = await sock(await cookieOf('customer'));
  const a = collect(staff, 'order:created'), b = collect(guest, 'order:created'), c = collect(cust, 'order:created');
  const r = await h.placeOrder(app, h.customerBody(base)); await h.sleep(250);
  assert.equal(r.status, 201); assert.equal(a.length, 1); assert.equal(b.length, 0); assert.equal(c.length, 0);
  assert.deepEqual(Object.keys(a[0]).sort(), ['at', 'orderId', 'orderNumber']);
  assert.ok(!JSON.stringify(a[0]).includes('Mona') && !JSON.stringify(a[0]).includes('0101'));
});
test('NO event is emitted when the operation fails (out of stock / validation / DB error)', async () => {
  const staff = await sock(await cookieOf('orders')); const pub = await sock();
  const a = collect(staff, 'order:created'), s = collect(staff, 'inventory:updated'), p = collect(pub, 'product:updated');
  await h.db.query('UPDATE products SET stock_quantity = 0 WHERE id = 2');
  assert.equal((await h.placeOrder(app, h.customerBody({ items: [{ productId: 2, quantity: 1 }] }))).status, 409);
  assert.equal((await h.placeOrder(app, h.customerBody({ items: [{ productId: 1, quantity: 0 }] }))).status, 400);
  await h.db.pool.query("CREATE TRIGGER boom2 BEFORE INSERT ON order_items FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'x'");
  try { assert.equal((await h.placeOrder(app, h.customerBody(base))).status, 500); } finally { await h.db.pool.query('DROP TRIGGER boom2'); }
  await h.sleep(300); assert.equal(a.length, 0); assert.equal(s.length, 0); assert.equal(p.length, 0);
});
test('product price change -> public product:updated (id only); stock sale -> staff inventory:updated', async () => {
  const pub = await sock(); const inv = await sock(await cookieOf('inventory'));
  const p = collect(pub, 'product:updated'), i = collect(inv, 'inventory:updated'), leak = collect(pub, 'inventory:updated');
  assert.equal((await h.patch(adm, '/api/admin/products/1', { price: 1600 })).status, 200);
  await h.db.query('UPDATE products SET stock_quantity = 10 WHERE id = 3'); await h.placeOrder(app, h.customerBody({ items: [{ productId: 3, quantity: 2 }] })); await h.sleep(250);
  assert.ok(p.some((e) => e.productId === 1)); assert.deepEqual(Object.keys(p[0]).sort(), ['at', 'productId']);
  assert.ok(i.some((e) => e.productId === 3 && e.quantity === 8)); assert.equal(leak.length, 0);
});
test('order status + shipping payment events reach staff and ONLY the owning customer', async () => {
  const staff = await sock(await cookieOf('orders')); const owner = await sock(); const other = await sock();
  const o = (await h.placeOrder(app, h.customerBody(base))).body.order; const id = (await h.db.query('SELECT id FROM orders WHERE order_number=?', [o.orderNumber]))[0].id;
  const ack1 = await new Promise((r) => owner.emit('order:subscribe', { orderNumber: o.orderNumber, token: o.trackingToken }, r)); assert.equal(ack1.ok, true);
  const ack2 = await new Promise((r) => other.emit('order:subscribe', { orderNumber: o.orderNumber, token: 'c'.repeat(32) }, r)); assert.equal(ack2.ok, false);
  const sp = collect(staff, 'shippingPayment:submitted'), sc = collect(staff, 'shippingPayment:confirmed'), st = collect(staff, 'order:statusChanged'), ow = collect(owner, 'order:statusChanged'), ot = collect(other, 'order:statusChanged'), ow2 = collect(owner, 'shippingPayment:confirmed');
  await h.submitReceipt(app, o); await h.post(om, `/api/admin/orders/${id}/shipping-payment/confirm`, { amount: 50 }); await h.post(om, `/api/admin/orders/${id}/status`, { status: 'processing' }); await h.sleep(300);
  assert.equal(sp.length, 1); assert.equal(sc.length, 1); assert.ok(st.length >= 3); assert.ok(ow.length >= 2); assert.equal(ow2.length, 1); assert.equal(ot.length, 0);
  assert.ok(!JSON.stringify(ow).includes('Mona'));
});
test('staff rooms cannot be joined by clients (no client-driven join)', async () => {
  const guest = await sock(); const got = collect(guest, 'order:created');
  guest.emit('join', 'staff:orders'); guest.emit('order:subscribe', { orderNumber: 'staff:orders', token: 'x' }, () => {});
  await h.placeOrder(app, h.customerBody(base)); await h.sleep(250); assert.equal(got.length, 0);
});
test('revoked/changed user is disconnected; reconnect works and REST gives the true state (resync)', async () => {
  const c = await sock(await cookieOf('inventory')); let dropped = false; c.on('disconnect', () => { dropped = true; });
  const [u] = await h.db.query('SELECT id FROM users WHERE email=?', [h.USERS.inventory]);
  await h.patch(adm, `/api/admin/users/${u.id}`, { isActive: false }); await h.sleep(250); assert.equal(dropped, true);
  const staff = await sock(await cookieOf('orders')); staff.close();
  const r = await om.agent.get('/api/admin/orders?limit=5'); assert.equal(r.status, 200); assert.ok(r.body.items.length > 0); // data after "reconnect" comes from MySQL via REST
});
