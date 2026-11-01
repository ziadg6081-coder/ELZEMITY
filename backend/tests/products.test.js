'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const h = require('./helpers');
let app, inv, adm, om;
test.before(async () => { await h.resetDb(); app = h.app(); inv = await h.login(app, 'inventory'); adm = await h.login(app, 'admin'); om = await h.login(app, 'orders'); });
test.after(async () => { await h.db.pool.end(); });
const P = { name: 'Test Oud', category: 'Men', price: 999.5, stock: 7, imageUrl: 'https://example.com/a.jpg' };

test('GET /products returns DB products (paginated, filtered, sorted)', async () => {
  const r = await h.request(app).get('/api/products?limit=3');
  assert.equal(r.status, 200); assert.equal(r.body.items.length, 3); assert.equal(r.body.total, 8);
  assert.equal((await h.request(app).get('/api/products?category=Men')).body.items.every((p) => p.category === 'Men'), true);
  const low = (await h.request(app).get('/api/products?sort=low')).body.items.map((p) => p.price);
  assert.deepEqual(low, [...low].sort((a, b) => a - b));
  assert.equal((await h.request(app).get('/api/products?limit=1000')).status, 400);
});
test('public product payload does not expose raw stock numbers', async () => {
  const p = (await h.request(app).get('/api/products/1')).body.product;
  assert.equal(p.stock_quantity, undefined); assert.equal(typeof p.inStock, 'boolean');
});
test('GET missing / malformed product', async () => {
  assert.equal((await h.request(app).get('/api/products/99999')).status, 404);
  assert.equal((await h.request(app).get('/api/products/abc')).status, 400);
});
test('create product: allowed role OK, others rejected, bad data rejected', async () => {
  const ok = await h.post(inv, '/api/admin/products', P); assert.equal(ok.status, 201); assert.equal(ok.body.product.stock, 7); assert.equal(ok.body.product.price, 999.5);
  assert.equal((await h.post(om, '/api/admin/products', P)).status, 403);
  assert.equal((await h.request(app).post('/api/admin/products').send(P)).status, 401);
  assert.equal((await h.post(inv, '/api/admin/products', { ...P, price: -5 })).status, 400);
  assert.equal((await h.post(inv, '/api/admin/products', { ...P, price: 10.999 })).status, 400);
  assert.equal((await h.post(inv, '/api/admin/products', { ...P, name: 'x' })).status, 400);
  assert.equal((await h.post(inv, '/api/admin/products', { ...P, imageUrl: 'javascript:alert(1)' })).status, 400);
  assert.equal((await h.post(inv, '/api/admin/products', { ...P, category: 'Nope' })).status, 422);
  const [mv] = await h.db.query("SELECT change_qty FROM inventory_movements WHERE reason='initial' AND product_id=?", [ok.body.product.id]); assert.equal(mv.change_qty, 7);
});
test('mass assignment: stock/id/unknown fields cannot be set through product PATCH', async () => {
  assert.equal((await h.patch(inv, '/api/admin/products/1', { stock: 9999 })).status, 400);
  assert.equal((await h.patch(inv, '/api/admin/products/1', { id: 5, deleted_at: null })).status, 400);
  assert.equal(await h.stockOf(1), 25);
});
test('price update is saved, audited, and public API reflects it', async () => {
  const r = await h.patch(inv, '/api/admin/products/1', { price: 1500 }); assert.equal(r.status, 200);
  assert.equal((await h.request(app).get('/api/products/1')).body.product.price, 1500);
  const [a] = await h.db.query("SELECT details FROM audit_logs WHERE action='product.updated' ORDER BY id DESC LIMIT 1");
  assert.equal((typeof a.details === 'string' ? JSON.parse(a.details) : a.details).oldPrice, '1450.00');
});
test('stock adjust: logged as movement, cannot go negative, requires a reason', async () => {
  assert.equal((await h.post(inv, '/api/admin/products/2/stock', { mode: 'delta', quantity: 5, note: 'restock' })).body.quantity, 30);
  assert.equal(await h.stockOf(2), 30);
  assert.equal((await h.post(inv, '/api/admin/products/2/stock', { mode: 'delta', quantity: -31, note: 'oops' })).status, 422);
  assert.equal((await h.post(inv, '/api/admin/products/2/stock', { mode: 'delta', quantity: -1 })).status, 400);
  const [m] = await h.db.query("SELECT change_qty, quantity_after, user_id FROM inventory_movements WHERE product_id=2 AND reason='manual_adjust'"); assert.equal(m.change_qty, 5); assert.equal(m.quantity_after, 30); assert.ok(m.user_id);
});
test('soft delete hides the product from the store but keeps the row', async () => {
  assert.equal((await h.del(adm, '/api/admin/products/3')).status, 200);
  assert.equal((await h.request(app).get('/api/products/3')).status, 404);
  assert.equal((await h.db.query('SELECT id FROM products WHERE id=3')).length, 1);
});
test('SQL injection attempts are inert', async () => {
  for (const q of ["' OR '1'='1", "'; DROP TABLE products; --", '%', '_']) { const r = await h.request(app).get('/api/products').query({ q }); assert.equal(r.status, 200); }
  assert.equal((await h.request(app).get('/api/products').query({ category: "Men' OR 1=1 --" })).body.items.length, 0);
  assert.equal((await h.request(app).get('/api/products').query({ sort: 'price; DROP TABLE users' })).status, 400);
  assert.ok((await h.db.query('SELECT COUNT(*) n FROM products'))[0].n >= 8);
  const login = await h.request(app).post('/api/auth/login').send({ email: "admin@test.com' OR '1'='1", password: 'x' }); assert.equal(login.status, 400);
});

test('product image upload from device: validated, stored under /media/products, served publicly, permission-protected', async () => {
  const up = (agent, csrf, file, name) => agent.post('/api/admin/products/1/image').set('X-CSRF-Token', csrf).attach('image', file, name);
  const ok = await up(inv.agent, inv.csrf, h.PNG, 'my photo.png'); assert.equal(ok.status, 200); assert.match(ok.body.imageUrl, /^\/media\/products\/[a-f0-9]{32}\.png$/);
  assert.equal((await h.request(app).get('/api/products/1')).body.product.image, ok.body.imageUrl);
  const f = await h.request(app).get(ok.body.imageUrl); assert.equal(f.status, 200); assert.equal(f.headers['content-type'], 'image/png'); assert.equal(f.headers['x-content-type-options'], 'nosniff');
  assert.equal((await up(inv.agent, inv.csrf, Buffer.from('<script>alert(1)</script>'), 'x.png')).status, 415);
  assert.equal((await up(om.agent, om.csrf, h.PNG, 'a.png')).status, 403);
  assert.equal((await h.request(app).post('/api/admin/products/1/image').attach('image', h.PNG, 'a.png')).status, 401);
  assert.equal((await up(inv.agent, inv.csrf, Buffer.concat([h.PNG, Buffer.alloc(6 * 1024 * 1024)]), 'big.png')).status, 413);
  const again = await up(inv.agent, inv.csrf, h.PNG, 'b.png'); assert.equal(again.status, 200);
  assert.equal((await h.request(app).get(ok.body.imageUrl)).status, 404); // replaced image file removed
  assert.equal((await h.request(app).get('/media/products/../../.env')).status === 200, false);
});
