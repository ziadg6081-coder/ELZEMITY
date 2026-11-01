'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const h = require('./helpers');
let app;
test.before(async () => { await h.resetDb(); app = h.app(); });
test.after(async () => { await h.db.pool.end(); });

test('login: correct credentials create a session with HttpOnly cookie', async () => {
  const r = await h.request(app).post('/api/auth/login').send({ email: h.USERS.admin, password: h.PW });
  assert.equal(r.status, 200); assert.equal(r.body.user.role, 'admin'); assert.ok(r.body.csrfToken);
  assert.match(r.headers['set-cookie'][0], /HttpOnly/); assert.match(r.headers['set-cookie'][0], /SameSite=Lax/);
  assert.ok(!JSON.stringify(r.body).includes('password'));
});
test('login: wrong password / unknown account / disabled account all get the same 401', async () => {
  const bad = await h.request(app).post('/api/auth/login').send({ email: h.USERS.admin, password: 'nope-nope-nope' });
  const unknown = await h.request(app).post('/api/auth/login').send({ email: 'ghost@test.com', password: 'whatever123' });
  const disabled = await h.request(app).post('/api/auth/login').send({ email: h.USERS.disabled, password: h.PW });
  for (const r of [bad, unknown, disabled]) { assert.equal(r.status, 401); assert.equal(r.body.error.code, 'INVALID_CREDENTIALS'); }
  assert.equal(bad.body.error.message, unknown.body.error.message);
});
test('login: account locks after repeated failures', async () => {
  for (let i = 0; i < 5; i++) await h.request(app).post('/api/auth/login').send({ email: h.USERS.inventory, password: 'wrong-wrong-1' });
  const r = await h.request(app).post('/api/auth/login').send({ email: h.USERS.inventory, password: h.PW });
  assert.equal(r.status, 429); assert.equal(r.body.error.code, 'ACCOUNT_LOCKED');
});
test('passwords are stored as bcrypt hashes', async () => {
  const [u] = await h.db.query('SELECT password_hash FROM users WHERE email=?', [h.USERS.admin]);
  assert.match(u.password_hash, /^\$2[aby]\$/); assert.ok(!u.password_hash.includes(h.PW));
});
test('admin API: no session -> 401, customer -> 403, staff -> 200', async () => {
  assert.equal((await h.request(app).get('/api/admin/orders')).status, 401);
  const cust = await h.login(app, 'customer');
  assert.equal((await cust.agent.get('/api/admin/orders')).status, 403);
  assert.equal((await cust.agent.get('/api/admin/users')).status, 403);
  const adm = await h.login(app, 'admin');
  assert.equal((await adm.agent.get('/api/admin/orders')).status, 200);
});
test('least privilege: order_manager cannot manage users/products/stock; inventory_manager cannot review payments', async () => {
  const om = await h.login(app, 'orders');
  assert.equal((await om.agent.get('/api/admin/users')).status, 403);
  assert.equal((await h.post(om, '/api/admin/products', { name: 'X Perfume', category: 'Men', price: 10 })).status, 403);
  assert.equal((await h.post(om, '/api/admin/products/1/stock', { mode: 'delta', quantity: 5, note: 'try it' })).status, 403);
  await h.db.query("UPDATE users SET locked_until=NULL, failed_logins=0");
  const im = await h.login(app, 'inventory');
  assert.equal((await h.post(im, '/api/admin/orders/1/shipping-payment/confirm', { amount: 50 })).status, 403);
  assert.equal((await im.agent.get('/api/admin/orders')).status, 200);
});
test('CSRF: state-changing request with a session but no token is rejected; wrong origin rejected', async () => {
  const adm = await h.login(app, 'admin');
  assert.equal((await adm.agent.post('/api/admin/coupons').send({ code: 'NOCSRF', discountType: 'percent', discountValue: 10 })).status, 403);
  const r = await adm.agent.post('/api/admin/coupons').set('X-CSRF-Token', adm.csrf).set('Origin', 'https://evil.example').send({ code: 'EVIL', discountType: 'percent', discountValue: 10 });
  assert.equal(r.status, 403);
  assert.equal((await h.post(adm, '/api/admin/coupons', { code: 'GOOD10', discountType: 'percent', discountValue: 10 })).status, 201);
});
test('logout revokes the session server-side', async () => {
  const c = await h.login(app, 'customer');
  assert.equal((await c.agent.get('/api/me/orders')).status, 200);
  const cookie = (await h.request(app).post('/api/auth/login').send({ email: h.USERS.customer, password: h.PW })).headers['set-cookie'][0].split(';')[0];
  assert.equal((await h.request(app).get('/api/me/orders').set('Cookie', cookie)).status, 200);
  const me = await h.request(app).get('/api/auth/me').set('Cookie', cookie);
  await h.request(app).post('/api/auth/logout').set('Cookie', cookie).set('X-CSRF-Token', me.body.csrfToken);
  assert.equal((await h.request(app).get('/api/me/orders').set('Cookie', cookie)).status, 401);
});
test('expired session is rejected', async () => {
  const c = await h.login(app, 'customer');
  await h.db.query('UPDATE sessions SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE) WHERE user_id = (SELECT id FROM users WHERE email=?)', [h.USERS.customer]);
  assert.equal((await c.agent.get('/api/me/orders')).status, 401);
});
test('register: creates a customer; duplicate email -> 409; role cannot be injected', async () => {
  const ok = await h.request(app).post('/api/auth/register').send({ name: 'New Person', email: 'new@test.com', password: 'longenough1' });
  assert.equal(ok.status, 201);
  assert.equal((await h.request(app).post('/api/auth/register').send({ name: 'New Person', email: 'new@test.com', password: 'longenough1' })).status, 409);
  const inj = await h.request(app).post('/api/auth/register').send({ name: 'Evil', email: 'evil@test.com', password: 'longenough1', role: 'admin' });
  assert.equal(inj.status, 400);
});
test('role change revokes the user sessions and is audited', async () => {
  const adm = await h.login(app, 'admin'); const c = await h.login(app, 'customer');
  const [u] = await h.db.query('SELECT id FROM users WHERE email=?', [h.USERS.customer]);
  assert.equal((await h.patch(adm, `/api/admin/users/${u.id}`, { role: 'order_manager' })).status, 200);
  assert.equal((await c.agent.get('/api/me/orders')).status, 401);
  assert.equal((await h.patch(adm, `/api/admin/users/${adm.user.id}`, { role: 'customer' })).status, 422); // cannot demote yourself
  const [a] = await h.db.query("SELECT details FROM audit_logs WHERE action='user.permissions_changed'"); assert.ok(a);
});
