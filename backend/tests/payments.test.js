'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const h = require('./helpers');
let app, om, adm, inv;
test.before(async () => { await h.resetDb(); app = h.app(); om = await h.login(app, 'orders'); adm = await h.login(app, 'admin'); inv = await h.login(app, 'inventory'); });
test.after(async () => { await h.db.pool.end(); });
const mk = async (items) => { const o = (await h.placeOrder(app, h.customerBody(items ? { items } : {}))).body.order; o.id = (await h.db.query('SELECT id FROM orders WHERE order_number=?', [o.orderNumber]))[0].id; return o; };
const state = async (id) => (await h.db.query('SELECT status, shipping_payment_status s FROM orders WHERE id=?', [id]))[0];

test('receipt upload moves the order to "under review" - it does NOT confirm payment', async () => {
  const o = await mk(); const r = await h.submitReceipt(app, o);
  assert.equal(r.status, 201); assert.equal(r.body.order.status, 'shipping_payment_under_review'); assert.equal(r.body.order.shippingPaymentStatus, 'submitted'); assert.equal(r.body.order.readyToShip, false);
  assert.equal((await h.post(om, `/api/admin/orders/${o.id}/status`, { status: 'processing' })).status, 409);
});
test('upload validation: wrong token, fake image, oversized, missing proof, double submission', async () => {
  const o = await mk();
  assert.equal((await h.request(app).post(`/api/orders/${o.orderNumber}/shipping-payment`).set('X-Order-Token', 'b'.repeat(32)).field('reference', 'X1').attach('receipt', h.PNG, 'r.png')).status, 404);
  const fake = await h.submitReceipt(app, o, { file: Buffer.from('<?php echo 1; ?><script>alert(1)</script>'), filename: 'evil.png' }); assert.equal(fake.status, 415);
  const big = await h.submitReceipt(app, o, { file: Buffer.concat([h.PNG, Buffer.alloc(6 * 1024 * 1024)]) }); assert.equal(big.status, 413);
  assert.equal((await h.request(app).post(`/api/orders/${o.orderNumber}/shipping-payment`).set('X-Order-Token', o.trackingToken).field('amountSent', '50')).status, 400);
  assert.equal((await state(o.id)).status, 'awaiting_shipping_payment');
  assert.equal((await h.submitReceipt(app, o)).status, 201);
  assert.equal((await h.submitReceipt(app, o)).status, 409);
  const fs = require('fs'); const files = fs.readdirSync(h.config.upload.dir); assert.ok(files.every((f) => /^[a-f0-9]{32}\.(png|jpg|webp)$/.test(f)));
});
test('only authorised reviewers can confirm: customer/guest/inventory_manager are refused', async () => {
  const o = await mk(); await h.submitReceipt(app, o);
  assert.equal((await h.request(app).post(`/api/admin/orders/${o.id}/shipping-payment/confirm`).send({ amount: 50 })).status, 401);
  const cust = await h.login(app, 'customer'); assert.equal((await h.post(cust, `/api/admin/orders/${o.id}/shipping-payment/confirm`, { amount: 50 })).status, 403);
  assert.equal((await h.post(inv, `/api/admin/orders/${o.id}/shipping-payment/confirm`, { amount: 50 })).status, 403);
  assert.equal((await state(o.id)).s, 'submitted');
});
test('confirm: amount must match shipping fee; success records reviewer + time; repeat is refused; audit written', async () => {
  const o = await mk(); await h.submitReceipt(app, o);
  const bad = await h.post(om, `/api/admin/orders/${o.id}/shipping-payment/confirm`, { amount: 30 }); assert.equal(bad.status, 422); assert.equal(bad.body.error.code, 'AMOUNT_MISMATCH');
  assert.equal((await h.post(om, `/api/admin/orders/${o.id}/shipping-payment/confirm`, { amount: 50 })).status, 200);
  const s = await state(o.id); assert.equal(s.status, 'confirmed'); assert.equal(s.s, 'confirmed');
  const [p] = await h.db.query("SELECT status, reviewed_by, reviewed_at, confirmed_amount FROM shipping_payments WHERE order_id=?", [o.id]);
  assert.equal(p.status, 'confirmed'); assert.ok(p.reviewed_by); assert.ok(p.reviewed_at); assert.equal(p.confirmed_amount, '50.00');
  assert.equal((await h.post(om, `/api/admin/orders/${o.id}/shipping-payment/confirm`, { amount: 50 })).status, 409);
  assert.equal((await h.post(om, `/api/admin/orders/${o.id}/shipping-payment/reject`, { reason: 'too late' })).status, 409);
  assert.equal((await h.db.query("SELECT 1 FROM audit_logs WHERE action='shipping_payment.confirmed' AND entity_id=?", [String(o.id)])).length, 1);
});
test('concurrent double-confirm: exactly one succeeds', async () => {
  const o = await mk(); await h.submitReceipt(app, o);
  const rs = await Promise.all([1, 2, 3].map(() => h.post(om, `/api/admin/orders/${o.id}/shipping-payment/confirm`, { amount: 50 })));
  assert.equal(rs.filter((r) => r.status === 200).length, 1); assert.equal((await h.db.query("SELECT 1 FROM audit_logs WHERE action='shipping_payment.confirmed' AND entity_id=?", [String(o.id)])).length, 1);
});
test('reject -> customer sees reason and can resubmit -> then confirm', async () => {
  const o = await mk(); await h.submitReceipt(app, o);
  assert.equal((await h.post(om, `/api/admin/orders/${o.id}/shipping-payment/reject`, { reason: 'Amount not received' })).status, 200);
  const v = (await h.request(app).get(`/api/orders/${o.orderNumber}`).set('X-Order-Token', o.trackingToken)).body.order;
  assert.equal(v.shippingPaymentStatus, 'rejected'); assert.equal(v.lastRejectReason, 'Amount not received'); assert.equal(v.status, 'awaiting_shipping_payment');
  assert.equal((await h.submitReceipt(app, o, { reference: 'IP999' })).status, 201);
  assert.equal((await h.post(om, `/api/admin/orders/${o.id}/shipping-payment/confirm`, { amount: 50 })).status, 200);
  assert.equal((await h.db.query('SELECT 1 FROM shipping_payments WHERE order_id=?', [o.id])).length, 2);
});
test('full lifecycle + COD: cannot ship before confirmation; COD must be recorded explicitly with the right amount', async () => {
  const o = await mk([{ productId: 4, quantity: 1 }]); // 1120 EGP
  assert.equal((await h.post(om, `/api/admin/orders/${o.id}/status`, { status: 'processing' })).status, 409);
  await h.submitReceipt(app, o); await h.post(om, `/api/admin/orders/${o.id}/shipping-payment/confirm`, { amount: 50 });
  for (const s of ['processing', 'shipped', 'delivered']) assert.equal((await h.post(om, `/api/admin/orders/${o.id}/status`, { status: s })).status, 200, s);
  let d = (await h.request(app).get(`/api/orders/${o.orderNumber}`).set('X-Order-Token', o.trackingToken)).body.order; assert.equal(d.codStatus, 'pending'); assert.equal(d.amounts.codRemaining, 1120);
  assert.equal((await h.post(om, `/api/admin/orders/${o.id}/cod`, { collected: true, amount: 1000 })).status, 422);
  assert.equal((await h.post(om, `/api/admin/orders/${o.id}/cod`, { collected: true, amount: 1120 })).status, 200);
  assert.equal((await h.post(om, `/api/admin/orders/${o.id}/cod`, { collected: true, amount: 1120 })).status, 409);
  d = (await h.request(app).get(`/api/orders/${o.orderNumber}`).set('X-Order-Token', o.trackingToken)).body.order; assert.equal(d.codStatus, 'collected'); assert.equal(d.amounts.codRemaining, 0);
  assert.equal((await h.post(om, `/api/admin/orders/${o.id}/status`, { status: 'cancelled' })).status, 409); // cannot cancel a delivered order
});
test('receipt images are private: reviewers only, correct headers', async () => {
  const o = await mk(); await h.submitReceipt(app, o);
  const [p] = await h.db.query('SELECT id FROM shipping_payments WHERE order_id=?', [o.id]);
  assert.equal((await h.request(app).get(`/api/admin/shipping-payments/${p.id}/receipt`)).status, 401);
  assert.equal((await inv.agent.get(`/api/admin/shipping-payments/${p.id}/receipt`)).status, 403);
  const r = await om.agent.get(`/api/admin/shipping-payments/${p.id}/receipt`); assert.equal(r.status, 200); assert.equal(r.headers['content-type'], 'image/png'); assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal((await h.request(app).get('/uploads/anything.png')).status, 404);
});


test('full prepayment: approval marks the full amount paid, without a COD collection', async () => {
  const r = await h.placeOrder(app, h.customerBody({ paymentMode: 'full' }));
  assert.equal(r.status, 201);
  const o = r.body.order;
  const [{ id }] = await h.db.query('SELECT id FROM orders WHERE order_number=?', [o.orderNumber]);
  assert.equal(o.paymentMode, 'full');
  assert.equal(o.amounts.codRemaining, 0);
  await h.submitReceipt(app, o);
  const bad = await h.post(om, `/api/admin/orders/${id}/shipping-payment/confirm`, { amount: o.amounts.shippingFee });
  assert.equal(bad.status, 422); // shipping-only amount must never approve a full payment
  const good = await h.post(om, `/api/admin/orders/${id}/shipping-payment/confirm`, { amount: o.amounts.grandTotal });
  assert.equal(good.status, 200);
  const detail = (await om.agent.get(`/api/admin/orders/${id}`)).body.order;
  assert.equal(detail.paymentMode, 'full');
  assert.equal(detail.shippingPaymentStatus, 'confirmed');
  assert.equal(detail.amounts.codRemaining, 0);
  assert.equal(detail.codStatus, 'pending'); // no COD is due; transfer confirmation is the payment record
  const list = (await om.agent.get('/api/admin/orders')).body.items;
  assert.equal(list.find(x => x.id === Number(id)).paymentMode, 'full');
  for (const status of ['processing', 'shipped', 'delivered']) {
    assert.equal((await h.post(om, `/api/admin/orders/${id}/status`, { status })).status, 200);
  }
  assert.equal((await h.post(om, `/api/admin/orders/${id}/cod`, { collected: true, amount: detail.amounts.productsTotal })).status, 409);
});
