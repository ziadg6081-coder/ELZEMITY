"use strict";
// Safe smoke tests: no MySQL connection, no database reset or writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.env.NODE_ENV = 'test';
const root = path.resolve(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const orders = require('../backend/server/services/orders');
const catalog = require('../backend/server/services/catalog');
const db = require('../backend/server/lib/db');

test('checkout totals can exceed EGP 10,000 with server-computed prices', () => {
  const product = {id: 1, name: 'Perfume', price: '12500.00', stock_quantity: 20, is_active: 1};
  const map = new Map([['1:0', product]]);
  const t = orders.computeTotals([{productId:1, quantity:2, variantId:null}], map, '50.00', null);
  assert.equal(t.grand, 2505000);
  assert.equal(t.priced[0].unit, 1250000);
  assert.equal(catalog.presentProduct(product).maxQty, 20);
});

test('DB decimal overflow is rejected with a useful error', () => {
  const map = new Map([['1:0', {id:1, price:'99999999.99'}]]);
  assert.throws(() => orders.computeTotals([{productId:1, quantity:2}], map, '50.00', null), /supported database amount/);
});

test('full-payment approval requires the entire grand total, and records only the reviewed transfer', async () => {
  const original = db.withTransaction;
  const statements = [];
  const order = {id:9, order_number:'OP-261031-ABCDEF', payment_mode:'full', grand_total:'15050.00', shipping_fee:'50.00', status:'shipping_payment_under_review', shipping_payment_status:'submitted'};
  const conn = {execute: async (sql, params=[]) => {
    statements.push({sql, params});
    if (sql.startsWith('SELECT * FROM orders')) return [[order]];
    if (sql.startsWith('SELECT * FROM shipping_payments')) return [[{id:4, status:'submitted'}]];
    return [{affectedRows:1}];
  }};
  db.withTransaction = async fn => fn(conn);
  try {
    await assert.rejects(orders.confirmShippingPayment({orderId:9, amount:'50.00', req:{user:{id:1}}}), /does not match/);
    assert.equal(statements.filter(x => x.sql.startsWith('UPDATE')).length, 0);
    statements.length=0;
    const result = await orders.confirmShippingPayment({orderId:9, amount:'15050.00', req:{user:{id:1}}});
    assert.equal(result.orderId,9);
    assert.equal(statements.filter(x => x.sql.startsWith('UPDATE')).length,2);
    assert.ok(statements.some(x => x.sql.includes('UPDATE shipping_payments')));
    assert.ok(statements.some(x => x.sql.includes("shipping_payment_status='confirmed'")));
    assert.ok(statements.every(x => !x.sql.includes('cod_amount_collected')));
  } finally { db.withTransaction=original; await db.pool.end(); }
});

test('admin shows paid-in-full based on transfer approval, hides COD action, and formats audit summaries', () => {
  const admin = source('frontend/js/admin.js');
  const api = source('backend/server/services/orders.js');
  const report = source('backend/server/routes/admin.js');
  assert.match(admin, /o\.paymentMode !== "full" && o\.status === "delivered"/);
  assert.match(admin, /o\.paymentMode === "full" \? a\.grandTotal : a\.shippingFee/);
  assert.match(admin, /auditSummary\(a\.details\)/);
  assert.match(admin, /auditSummary\(h\.details\)/);
  assert.match(api, /shipping_payment_status, payment_mode, cod_status, grand_total/);
  assert.match(report, /payment_mode = 'full' THEN grand_total ELSE shipping_fee/);
});

test('quantity and transfer validation matches existing database column constraints', () => {
  const route = source('backend/server/routes/public.js');
  assert.match(route, /quantity: z\.number\(\)\.int\(\)\.min\(1\)\.max\(50\)/);
  assert.match(route, /amountSent: z\.coerce\.number\(\)\.positive\(\)\.max\(99999999\.99\)/);
});
