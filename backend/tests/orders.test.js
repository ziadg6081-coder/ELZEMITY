'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const h = require('./helpers');
let app, adm, om;
test.before(async () => { await h.resetDb({ stock: 5 }); app = h.app(); adm = await h.login(app, 'admin'); om = await h.login(app, 'orders'); });
test.after(async () => { await h.db.pool.end(); });
const count = async () => Number((await h.db.query('SELECT COUNT(*) n FROM orders'))[0].n);

test('valid order: server computes totals; COD / InstaPay split is correct; stock deducted; movement + audit written', async () => {
  const r = await h.placeOrder(app, h.customerBody({ items: [{ productId: 1, quantity: 2 }, { productId: 2, quantity: 1 }] }));
  assert.equal(r.status, 201); const o = r.body.order;
  assert.equal(o.amounts.productsSubtotal, 4180); assert.equal(o.amounts.shippingFee, 50); assert.equal(o.amounts.grandTotal, 4230);
  assert.equal(o.amounts.productsTotal, 4180); assert.equal(o.amounts.shippingDueNow, 50); assert.equal(o.amounts.codRemaining, 4180);
  assert.equal(o.status, 'awaiting_shipping_payment'); assert.equal(o.shippingPaymentStatus, 'unpaid'); assert.equal(o.readyToShip, false);
  assert.match(o.orderNumber, /^OP-\d{6}-[A-Z0-9]{6}$/); assert.equal(o.trackingToken.length, 32);
  assert.equal(await h.stockOf(1), 3); assert.equal(await h.stockOf(2), 4);
  const mv = await h.db.query("SELECT * FROM inventory_movements WHERE reason='sale'"); assert.equal(mv.length, 2);
  assert.equal((await h.db.query("SELECT * FROM audit_logs WHERE action='order.created'")).length, 1);
});
test('client-supplied price / shipping / discount / status / userId are rejected (mass assignment)', async () => {
  for (const extra of [{ price: 1 }, { shippingFee: 0 }, { discount: 999 }, { status: 'confirmed' }, { userId: 1 }, { total: 1 }]) {
    const r = await h.placeOrder(app, { ...h.customerBody(), ...extra }); assert.equal(r.status, 400, JSON.stringify(extra));
  }
  const r = await h.placeOrder(app, h.customerBody({ items: [{ productId: 3, quantity: 1, price: 1 }] })); assert.equal(r.status, 400);
});
test('invalid products / quantities / zones / missing idempotency key', async () => {
  assert.equal((await h.placeOrder(app, h.customerBody({ items: [{ productId: 9999, quantity: 1 }] }))).status, 422);
  for (const q of [0, -1, 1.5, 51, '2']) assert.equal((await h.placeOrder(app, h.customerBody({ items: [{ productId: 1, quantity: q }] }))).status, 400);
  assert.equal((await h.placeOrder(app, h.customerBody({ governorate: 'Atlantis' }))).status, 422);
  assert.equal((await h.placeOrder(app, h.customerBody({ items: [] }))).status, 400);
  assert.equal((await h.request(app).post('/api/orders').send(h.customerBody())).status, 400);
  assert.equal((await h.placeOrder(app, h.customerBody({ phone: 'abc' }))).status, 400);
});
test('coupons: invalid rejected; valid percent coupon applied server-side and counted once', async () => {
  assert.equal((await h.placeOrder(app, h.customerBody({ couponCode: 'NOPE' }))).status, 422);
  await h.post(adm, '/api/admin/coupons', { code: 'TEN', discountType: 'percent', discountValue: 10, maxUses: 1 });
  const r = await h.placeOrder(app, h.customerBody({ items: [{ productId: 4, quantity: 1 }], couponCode: 'ten' }));
  assert.equal(r.status, 201); assert.equal(r.body.order.amounts.discount, 112); assert.equal(r.body.order.amounts.productsTotal, 1008);
  assert.equal((await h.placeOrder(app, h.customerBody({ items: [{ productId: 4, quantity: 1 }], couponCode: 'TEN' }))).status, 422); // max uses reached
  await h.post(adm, '/api/admin/coupons', { code: 'BIG', discountType: 'fixed', discountValue: 500, minSubtotal: 5000 });
  assert.equal((await h.placeOrder(app, h.customerBody({ couponCode: 'BIG' }))).status, 422); // below minimum
});
test('idempotency: same key + same request returns the SAME order and deducts stock once', async () => {
  const before = await h.stockOf(7); const key = h.newKey(); const n = await count();
  const a = await h.placeOrder(app, h.customerBody({ items: [{ productId: 7, quantity: 1 }] }), key);
  const b = await h.placeOrder(app, h.customerBody({ items: [{ productId: 7, quantity: 1 }] }), key);
  assert.equal(a.status, 201); assert.equal(b.status, 201); assert.equal(b.headers['idempotent-replay'], 'true');
  assert.equal(a.body.order.orderNumber, b.body.order.orderNumber);
  assert.equal(await count(), n + 1); assert.equal(await h.stockOf(7), before - 1);
  const c = await h.placeOrder(app, h.customerBody({ items: [{ productId: 7, quantity: 2 }] }), key); // same key, different payload
  assert.equal(c.status, 422); assert.equal(c.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
});
test('idempotency under true concurrency: 5 parallel identical requests -> exactly one order', async () => {
  const key = h.newKey(); const before = await h.stockOf(8); const n = await count();
  const rs = await Promise.all(Array.from({ length: 5 }, () => h.placeOrder(app, h.customerBody({ items: [{ productId: 8, quantity: 1 }] }), key)));
  assert.ok(rs.every((r) => r.status === 201)); assert.equal(new Set(rs.map((r) => r.body.order.orderNumber)).size, 1);
  assert.equal(await count(), n + 1); assert.equal(await h.stockOf(8), before - 1);
});
test('stock race: 8 simultaneous buyers for the last 5 units -> exactly 5 succeed, stock never negative', async () => {
  await h.db.query('UPDATE products SET stock_quantity = 5 WHERE id = 5');
  const rs = await Promise.all(Array.from({ length: 8 }, () => h.placeOrder(app, h.customerBody({ items: [{ productId: 5, quantity: 1 }] }))));
  const ok = rs.filter((r) => r.status === 201).length; const fail = rs.filter((r) => r.status === 409);
  assert.equal(ok, 5); assert.equal(fail.length, 3); assert.ok(fail.every((r) => r.body.error.code === 'INSUFFICIENT_STOCK'));
  assert.equal(await h.stockOf(5), 0);
  const sold = Number((await h.db.query("SELECT COALESCE(SUM(-change_qty),0) n FROM inventory_movements WHERE product_id=5 AND reason='sale'"))[0].n); assert.equal(sold, 5);
});
test('last piece: two buyers each want the final unit -> one wins', async () => {
  await h.db.query('UPDATE products SET stock_quantity = 1 WHERE id = 6');
  const rs = await Promise.all([h.placeOrder(app, h.customerBody({ items: [{ productId: 6, quantity: 1 }] })), h.placeOrder(app, h.customerBody({ items: [{ productId: 6, quantity: 1 }] }))]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409]); assert.equal(await h.stockOf(6), 0);
});
test('no partial orders: if the 2nd line is out of stock the whole order rolls back (1st product untouched)', async () => {
  const n = await count(); const s3 = await h.stockOf(3); const key = h.newKey();
  const r = await h.placeOrder(app, h.customerBody({ items: [{ productId: 3, quantity: 1 }, { productId: 5, quantity: 1 }] }), key);
  assert.equal(r.status, 409); assert.equal(await count(), n); assert.equal(await h.stockOf(3), s3);
  assert.equal((await h.db.query('SELECT 1 FROM idempotency_keys WHERE key_hash = SHA2(?,256)', [key])).length, 0); // key is released so the customer can retry
  assert.equal((await h.db.query("SELECT 1 FROM inventory_movements WHERE product_id=3 AND reason='sale'")).length, 0);
});
test('DB failure mid-transaction leaves no order and no stock change', async () => {
  const n = await count(); const s = await h.stockOf(1);
  await h.db.pool.query("CREATE TRIGGER boom BEFORE INSERT ON order_items FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'boom-secret-detail'"); // simulate a DB failure on the 2nd statement of the transaction
  let r; try { r = await h.placeOrder(app, h.customerBody()); } finally { await h.db.pool.query('DROP TRIGGER boom'); }
  assert.equal(r.status, 500); assert.ok(!JSON.stringify(r.body).includes('boom-secret-detail')); assert.ok(!JSON.stringify(r.body).includes('stack'));
  assert.equal(await count(), n); assert.equal(await h.stockOf(1), s);
});
test('price snapshot: changing the product price later does not change old orders', async () => {
  await h.db.query('UPDATE products SET stock_quantity = 20 WHERE id = 1');
  const o = (await h.placeOrder(app, h.customerBody({ items: [{ productId: 1, quantity: 1 }] }))).body.order;
  await h.patch(adm, '/api/admin/products/1', { price: 9999 });
  const view = await h.request(app).get(`/api/orders/${o.orderNumber}`).set('X-Order-Token', o.trackingToken);
  assert.equal(view.body.order.items[0].unitPrice, 1450); assert.equal(view.body.order.amounts.grandTotal, 1500);
  const next = (await h.placeOrder(app, h.customerBody({ items: [{ productId: 1, quantity: 1 }] }))).body.order; assert.equal(next.items[0].unitPrice, 9999);
  await h.patch(adm, '/api/admin/products/1', { price: 1450 });
});
test('cancel returns stock exactly once; second cancel and status skips are refused', async () => {
  const o = (await h.placeOrder(app, h.customerBody({ items: [{ productId: 2, quantity: 2 }] }))).body.order; const id = (await h.db.query('SELECT id FROM orders WHERE order_number=?', [o.orderNumber]))[0].id;
  const before = await h.stockOf(2);
  assert.equal((await h.post(om, `/api/admin/orders/${id}/status`, { status: 'shipped' })).status, 409);
  assert.equal((await h.post(om, `/api/admin/orders/${id}/status`, { status: 'confirmed' })).status, 422);
  assert.equal((await h.post(om, `/api/admin/orders/${id}/status`, { status: 'cancelled', reason: 'customer asked' })).status, 200);
  assert.equal(await h.stockOf(2), before + 2);
  assert.equal((await h.post(om, `/api/admin/orders/${id}/status`, { status: 'cancelled' })).status, 409);
  assert.equal(await h.stockOf(2), before + 2);
  assert.equal((await h.db.query("SELECT 1 FROM inventory_movements WHERE reason='cancel_restock' AND reference_id=?", [id])).length, 1);
  await assert.rejects(h.db.query("INSERT INTO inventory_movements (product_id, change_qty, quantity_after, reason, reference_type, reference_id) VALUES (2, 2, 99, 'cancel_restock', 'order', ?)", [id])); // DB-level guard
});
test('unpaid orders expire automatically and return stock', async () => {
  const orders = require('../server/services/orders');
  const o = (await h.placeOrder(app, h.customerBody({ items: [{ productId: 4, quantity: 1 }] }))).body.order; const s = await h.stockOf(4);
  await h.db.query("UPDATE orders SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR) WHERE order_number = ?", [o.orderNumber]);
  assert.ok(await orders.expireUnpaidOrders() >= 1);
  assert.equal(await h.stockOf(4), s + 1);
  assert.equal((await h.db.query('SELECT status FROM orders WHERE order_number=?', [o.orderNumber]))[0].status, 'cancelled');
  assert.equal(await orders.expireUnpaidOrders(), 0);
});
test('order tracking needs the right token; customers cannot read each other\'s orders', async () => {
  await h.db.query('UPDATE products SET stock_quantity = 20 WHERE id = 1');
  const o = (await h.placeOrder(app, h.customerBody())).body.order;
  assert.equal((await h.request(app).get(`/api/orders/${o.orderNumber}`)).status, 400);
  assert.equal((await h.request(app).get(`/api/orders/${o.orderNumber}`).set('X-Order-Token', 'a'.repeat(32))).status, 404);
  assert.equal((await h.request(app).get(`/api/orders/${o.orderNumber}`).set('X-Order-Token', o.trackingToken)).status, 200);
  const view = (await h.request(app).get(`/api/orders/${o.orderNumber}`).set('X-Order-Token', o.trackingToken)).body.order; assert.equal(view.customer.phone, undefined); assert.equal(view.customer.address, undefined);
});
test('quote endpoint matches order totals and never changes stock', async () => {
  await h.db.query('UPDATE products SET stock_quantity = 20 WHERE id = 1');
  const s = await h.stockOf(1);
  const q = await h.request(app).post('/api/quote').send({ items: [{ productId: 1, quantity: 2 }], governorate: 'Alexandria' });
  assert.equal(q.body.quote.grandTotal, 2900 + 65); assert.equal(await h.stockOf(1), s);
});


test('checkout accepts orders above EGP 10,000 when stock is available', async () => {
  await h.db.query('UPDATE products SET stock_quantity = 20 WHERE id = 1');
  const r = await h.placeOrder(app, h.customerBody({ items: [{ productId: 1, quantity: 11 }] }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.order.amounts.grandTotal > 10000);
});
