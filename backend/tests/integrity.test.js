'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const h = require('./helpers');
test.before(async () => { await h.resetDb(); });
test.after(async () => { await h.db.pool.end(); });
const q = (s, p) => h.db.query(s, p);

test('DB refuses negative stock, negative prices, bad coupon values', async () => {
  await assert.rejects(q('UPDATE products SET stock_quantity = -1 WHERE id = 1'));
  await assert.rejects(q('UPDATE products SET price = -1 WHERE id = 1'));
  await assert.rejects(q("INSERT INTO coupons (code, discount_type, discount_value) VALUES ('X','percent',150)"));
});
test('foreign keys: cannot delete a product that has order history; cannot insert orphan items', async () => {
  const o = (await h.placeOrder(h.app(), h.customerBody())).body.order;
  await assert.rejects(q('DELETE FROM products WHERE id = 1'));
  await assert.rejects(q("INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, line_total) VALUES (999999, 1, 'x', 1, 1, 1)"));
  assert.ok(o.orderNumber);
});
test('only ONE live shipping payment per order (generated unique key)', async () => {
  const [o] = await q('SELECT id FROM orders LIMIT 1');
  await q("INSERT INTO shipping_payments (order_id, status, amount_claimed) VALUES (?, 'submitted', 50)", [o.id]);
  await assert.rejects(q("INSERT INTO shipping_payments (order_id, status, amount_claimed) VALUES (?, 'submitted', 50)", [o.id]));
  await q("UPDATE shipping_payments SET status='rejected' WHERE order_id=?", [o.id]);
  await q("INSERT INTO shipping_payments (order_id, status, amount_claimed) VALUES (?, 'submitted', 50)", [o.id]); // allowed again after rejection
});
test('stock ledger matches stock: sum of movements == current stock for every product', async () => {
  const app = h.app(); await Promise.all(Array.from({ length: 6 }, (_, i) => h.placeOrder(app, h.customerBody({ items: [{ productId: (i % 3) + 1, quantity: 2 }] }))));
  const rows = await q('SELECT p.id, p.stock_quantity s, COALESCE(SUM(m.change_qty),0) m FROM products p LEFT JOIN inventory_movements m ON m.product_id = p.id GROUP BY p.id');
  for (const r of rows) assert.equal(Number(r.s), Number(r.m), `product ${r.id}`);
});
test('money consistency: totals equal item sums on every order', async () => {
  const bad = await q('SELECT o.id FROM orders o WHERE ABS(o.subtotal - (SELECT SUM(line_total) FROM order_items i WHERE i.order_id=o.id)) > 0.001 OR ABS(o.products_total + o.shipping_fee - o.grand_total) > 0.001');
  assert.equal(bad.length, 0);
});
test('migrations are tracked and tamper-evident', async () => {
  const rows = await q('SELECT version FROM schema_migrations ORDER BY version'); assert.deepEqual(rows.map((r) => r.version), ['001', '002', '003', '004']);
  const engines = await q("SELECT DISTINCT engine e FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type='BASE TABLE'"); assert.deepEqual(engines.map((r) => r.e), ['InnoDB']);
});
