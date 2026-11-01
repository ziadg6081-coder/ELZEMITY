'use strict';
const crypto = require('crypto');
const db = require('../lib/db');
const logger = require('../lib/logger');
const realtime = require('../lib/realtime');
const { audit } = require('../lib/audit');
const { toCents, fromCents, percentOf } = require('../lib/money');
const { badRequest, notFound, conflict, unprocessable } = require('../lib/errors');
const { safeEqual, sha256 } = require('../middleware/auth');
const { getSettings } = require('./catalog');

/* ------------------------------------------------------------------ *
 * Order lifecycle (see DATABASE.md / API.md)
 *   awaiting_shipping_payment -> shipping_payment_under_review -> confirmed -> processing -> shipped -> delivered
 *   cancel allowed before "shipped" (stock is returned exactly once); returned allowed after shipped.
 *   "confirmed" is reachable ONLY through confirmShippingPayment() (a reviewed, authorized action).
 * ------------------------------------------------------------------ */
const TRANSITIONS = {
  pending: ['awaiting_shipping_payment', 'cancelled'],
  awaiting_shipping_payment: ['shipping_payment_under_review', 'cancelled'],
  shipping_payment_under_review: ['confirmed', 'awaiting_shipping_payment', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'returned'],
  delivered: ['returned'],
  cancelled: [],
  returned: [],
};
const MANUAL_TARGETS = new Set(['processing', 'shipped', 'delivered', 'cancelled', 'returned']);

const ORDER_NUMBER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newOrderNumber() {
  const d = new Date();
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const bytes = crypto.randomBytes(6);
  let s = '';
  for (const b of bytes) s += ORDER_NUMBER_ALPHABET[b % ORDER_NUMBER_ALPHABET.length];
  return `OP-${ymd}-${s}`;
}
const num = (v) => Number(v);

/* ---------------------------- presenters ---------------------------- */
async function loadItems(orderId, conn) {
  const sql = 'SELECT product_id, product_name, brand, size_label, unit_price, quantity, line_total FROM order_items WHERE order_id = ? ORDER BY id';
  const [rows] = conn ? await conn.execute(sql, [orderId]) : [await db.query(sql, [orderId])];
  return rows.map((i) => ({ productId: num(i.product_id), name: i.product_name, brand: i.brand, size: i.size_label, unitPrice: num(i.unit_price), quantity: i.quantity, lineTotal: num(i.line_total) }));
}

function amounts(o) {
  const shippingConfirmed = o.shipping_payment_status === 'confirmed';
  const full = o.payment_mode === 'full';
  return {
    productsSubtotal: num(o.subtotal),
    discount: num(o.discount_total),
    productsTotal: num(o.products_total),          // product value; COD only for shipping_only
    shippingFee: num(o.shipping_fee),              // paid up-front via InstaPay
    grandTotal: num(o.grand_total),
    shippingDueNow: shippingConfirmed ? 0 : num(o.shipping_fee),
    paymentDueNow: shippingConfirmed ? 0 : (full ? num(o.grand_total) : num(o.shipping_fee)),
    codRemaining: full || o.cod_status === 'collected' ? 0 : num(o.products_total),
  };
}

async function presentOrderForCustomer(o, settings, lastRejectReason, conn) {
  const items = await loadItems(o.id, conn);
  const awaiting = o.status === 'awaiting_shipping_payment' && ['unpaid', 'rejected'].includes(o.shipping_payment_status);
  return {
    orderNumber: o.order_number,
    status: o.status,
    shippingPaymentStatus: o.shipping_payment_status,
    paymentMode: o.payment_mode || 'shipping_only',
    codStatus: o.cod_status,
    readyToShip: ['confirmed', 'processing'].includes(o.status) && o.shipping_payment_status === 'confirmed',
    createdAt: o.created_at,
    expiresAt: awaiting ? o.expires_at : null,
    customer: { name: o.customer_name, governorate: o.governorate, city: o.city, address: o.address, note: o.customer_note || '' },
    items,
    amounts: amounts(o),
    couponCode: o.coupon_code || null,
    instapay: awaiting || o.shipping_payment_status === 'submitted' ? { handle: settings.instapay_handle || null, accountName: settings.instapay_account_name || null } : null,
    lastRejectReason: o.shipping_payment_status === 'rejected' ? (lastRejectReason || null) : null,
  };
}

async function presentOrderForStaff(o) {
  const items = await loadItems(o.id);
  const payments = await db.query(
    `SELECT sp.id, sp.status, sp.amount_claimed, sp.reference_number, (sp.receipt_file IS NOT NULL) AS has_receipt, sp.submitted_at,
            sp.reviewed_at, sp.confirmed_amount, sp.reject_reason, u.name AS reviewer
       FROM shipping_payments sp LEFT JOIN users u ON u.id = sp.reviewed_by WHERE sp.order_id = ? ORDER BY sp.id DESC`, [o.id]);
  return {
    id: num(o.id), orderNumber: o.order_number, status: o.status, shippingPaymentStatus: o.shipping_payment_status,
    paymentMode: o.payment_mode || 'shipping_only',
    codStatus: o.cod_status, codAmountCollected: o.cod_amount_collected === null ? null : num(o.cod_amount_collected), codCollectedAt: o.cod_collected_at,
    createdAt: o.created_at, updatedAt: o.updated_at, expiresAt: o.expires_at, cancelReason: o.cancel_reason, stockRestored: !!o.stock_restored,
    customer: { name: o.customer_name, phone: o.phone, email: o.email, governorate: o.governorate, city: o.city, address: o.address, note: o.customer_note || '', userId: o.user_id ? num(o.user_id) : null },
    items, amounts: amounts(o), couponCode: o.coupon_code || null,
    payments: payments.map((p) => ({ id: num(p.id), status: p.status, amountClaimed: num(p.amount_claimed), reference: p.reference_number, hasReceipt: !!p.has_receipt, submittedAt: p.submitted_at, reviewedAt: p.reviewed_at, confirmedAmount: p.confirmed_amount === null ? null : num(p.confirmed_amount), rejectReason: p.reject_reason, reviewer: p.reviewer })),
    allowedNext: (TRANSITIONS[o.status] || []).filter((s) => MANUAL_TARGETS.has(s)),
  };
}

/* ---------------------------- pricing ---------------------------- */
function mergeLines(items) {
  const m = new Map();
  for (const it of items) { const key = `${it.productId}:${it.variantId || 0}`; const old = m.get(key); m.set(key, { productId: it.productId, variantId: it.variantId || null, quantity: (old?.quantity || 0) + it.quantity }); }
  return [...m.values()].sort((a, b) => a.productId - b.productId || (a.variantId || 0) - (b.variantId || 0));
}

/** Pure server-side price computation from DB rows. Nothing price-related is ever read from the client. */
function computeTotals(lines, productMap, zoneFee, coupon) {
  let subtotal = 0;
  const priced = lines.map((l) => {
    const p = productMap.get(`${l.productId}:${l.variantId || 0}`) || productMap.get(`${l.productId}:0`);
    const unit = toCents(p.price);
    const lineTotal = unit * l.quantity;
    subtotal += lineTotal;
    return { ...l, product: p, unit, lineTotal };
  });
  let discount = 0;
  if (coupon) {
    discount = coupon.discount_type === 'percent' ? percentOf(subtotal, coupon.discount_value) : toCents(coupon.discount_value);
    discount = Math.min(discount, subtotal);
  }
  const productsTotal = subtotal - discount;
  const shipping = toCents(zoneFee);
  // MySQL money columns are DECIMAL(10,2); reject overflow cleanly rather than a 500.
  // There is intentionally no EGP 10,000 checkout ceiling.
  if (subtotal > 9999999999 || productsTotal + shipping > 9999999999) {
    throw unprocessable('Order total exceeds the supported database amount', 'ORDER_TOTAL_TOO_LARGE');
  }
  return { priced, subtotal, discount, productsTotal, shipping, grand: productsTotal + shipping };
}

function checkCoupon(c, subtotalCents) {
  if (!c || !c.is_active) throw unprocessable('Invalid coupon code', 'INVALID_COUPON');
  if (c.expires_at && new Date(c.expires_at) < new Date()) throw unprocessable('This coupon has expired', 'INVALID_COUPON');
  if (c.max_uses !== null && c.used_count >= c.max_uses) throw unprocessable('This coupon has reached its usage limit', 'INVALID_COUPON');
  if (subtotalCents < toCents(c.min_subtotal)) throw unprocessable(`Minimum order value for this coupon is EGP ${c.min_subtotal}`, 'INVALID_COUPON');
}

function validateProducts(lines, productMap) {
  const quantities = new Map();
  for (const l of lines) {
    const p = productMap.get(`${l.productId}:${l.variantId || 0}`) || productMap.get(`${l.productId}:0`);
    if (!p || !p.is_active || p.deleted_at) throw unprocessable(`Product ${l.productId} is not available`, 'PRODUCT_UNAVAILABLE', { productId: l.productId });
    const key = String(l.productId); quantities.set(key, (quantities.get(key) || 0) + l.quantity);
  }
  for (const [productId, quantity] of quantities) {
    const p = productMap.get(`${productId}:0`) || [...productMap.values()].find(x => num(x.id) === Number(productId));
    if (!p || Number(p.stock_quantity) < quantity) throw conflict(`Only ${p?.stock_quantity ?? 0} left of "${p?.name || productId}"`, 'INSUFFICIENT_STOCK', { productId: Number(productId), available: Number(p?.stock_quantity || 0) });
  }
}

const placeholders = (n) => Array(n).fill('?').join(',');

/** Read-only price quote (no stock is touched). */
async function quote({ items, governorate, couponCode }) {
  const lines = mergeLines(items);
  const ids = lines.map((l) => l.productId);
  const rows = await db.query(`SELECT id, name, brand, image_url, size_label, price, stock_quantity, is_active, deleted_at FROM products WHERE id IN (${placeholders(ids.length)})`, ids);
  const map = new Map(rows.map((r) => [`${num(r.id)}:0`, r]));
  const variantLines = lines.filter(l => l.variantId);
  if (variantLines.length) { const vrows = await db.query(`SELECT v.id AS variant_id, v.product_id, v.size_label, v.price AS variant_price, v.is_active AS variant_active, p.id, p.name, p.brand, p.image_url, p.size_label AS base_size, p.price AS base_price, p.stock_quantity, p.is_active, p.deleted_at FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id IN (${placeholders(variantLines.map(l=>l.variantId).length)})`, variantLines.map(l=>l.variantId)); for (const v of vrows) { const r = { ...v, price: v.variant_price, size_label: v.size_label, is_active: v.is_active && v.variant_active }; map.set(`${num(v.product_id)}:${num(v.variant_id)}`, r); } for (const l of variantLines) { const v = vrows.find(x => num(x.variant_id) === l.variantId); if (!v || num(v.product_id) !== l.productId) throw unprocessable('Invalid product variant', 'INVALID_VARIANT'); } }
  validateProducts(lines, map);
  const subtotalOnly = lines.reduce((s, l) => s + toCents((map.get(`${l.productId}:${l.variantId || 0}`) || map.get(`${l.productId}:0`)).price) * l.quantity, 0);
  let zoneFee = null;
  if (governorate) {
    const [z] = await db.query('SELECT fee FROM shipping_zones WHERE governorate = ? AND is_active = 1', [governorate]);
    if (!z) throw unprocessable('Shipping is not available to this governorate', 'NO_SHIPPING_ZONE');
    zoneFee = z.fee;
  }
  let coupon = null;
  if (couponCode) { [coupon] = await db.query('SELECT * FROM coupons WHERE code = ?', [couponCode.toUpperCase()]); checkCoupon(coupon, subtotalOnly); }
  const t = computeTotals(lines, map, zoneFee ?? '0.00', coupon);
  return { items: t.priced.map(l => ({ productId: l.productId, variantId: l.variantId || null, name: l.product.name, brand: l.product.brand, size: l.product.size_label, image: l.product.image_url || "", quantity: l.quantity, unitPrice: num(fromCents(l.unit)), lineTotal: num(fromCents(l.lineTotal)) })), subtotal: num(fromCents(t.subtotal)), discount: num(fromCents(t.discount)), additionalDiscount: 0, productsTotal: num(fromCents(t.productsTotal)), shippingFee: zoneFee === null ? null : num(fromCents(t.shipping)), grandTotal: zoneFee === null ? null : num(fromCents(t.grand)) };
}

/* ---------------------------- create order ---------------------------- */
class IdempotencyConflict extends Error {}

async function createOrder({ input, user, idemKey, req }) {
  const lines = mergeLines(input.items);
  const canonical = JSON.stringify({ lines, c: [input.name, input.phone, input.email || '', input.governorate, input.city, input.address, input.note || ''], m: input.paymentMode || 'shipping_only', k: (input.couponCode || '').toUpperCase() });
  const requestHash = sha256(canonical);
  const scope = user ? `user:${user.id}` : 'guest';
  const keyHash = sha256(idemKey);
  const settings = await getSettings();
  const windowHours = Math.max(1, Number(settings.shipping_payment_window_hours || 48));

  let result;
  try {
    result = await db.withTransaction(async (conn) => {
      // 1) Claim the idempotency key INSIDE the transaction. A concurrent duplicate blocks on the unique index until we commit/rollback.
      try {
        await conn.execute('INSERT INTO idempotency_keys (scope, key_hash, request_hash) VALUES (?,?,?)', [scope, keyHash, requestHash]);
      } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') throw new IdempotencyConflict();
        throw e;
      }

      // 2) Lock product rows in id order (prevents deadlocks) and read CURRENT prices/stock from MySQL.
      const ids = lines.map((l) => l.productId);
      const [rows] = await conn.execute(`SELECT id, name, brand, image_url, size_label, price, stock_quantity, is_active, deleted_at FROM products WHERE id IN (${placeholders(ids.length)}) ORDER BY id FOR UPDATE`, ids);
      const map = new Map(rows.map((r) => [`${num(r.id)}:0`, r]));
      const variantLines = lines.filter(l => l.variantId);
      if (variantLines.length) { const vIds = variantLines.map(l => l.variantId); const [vrows] = await conn.execute(`SELECT v.id AS variant_id, v.product_id, v.size_label, v.price AS variant_price, v.is_active AS variant_active, p.id, p.name, p.brand, p.image_url, p.size_label AS base_size, p.stock_quantity, p.is_active, p.deleted_at FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id IN (${placeholders(vIds.length)}) ORDER BY v.id FOR UPDATE`, vIds); for (const v of vrows) map.set(`${num(v.product_id)}:${num(v.variant_id)}`, { ...v, price: v.variant_price, size_label: v.size_label, is_active: v.is_active && v.variant_active }); for (const l of variantLines) { const v = vrows.find(x => num(x.variant_id) === l.variantId); if (!v || num(v.product_id) !== l.productId) throw unprocessable('Invalid product variant', 'INVALID_VARIANT'); } }
      validateProducts(lines, map);

      // 3) Shipping from server-side zone table.
      const [[zone]] = await conn.execute('SELECT fee FROM shipping_zones WHERE governorate = ? AND is_active = 1', [input.governorate]);
      if (!zone) throw unprocessable('Shipping is not available to this governorate', 'NO_SHIPPING_ZONE');

      // 4) Coupon (locked row so max_uses cannot be exceeded by concurrent orders).
      let coupon = null;
      if (input.couponCode) {
        [[coupon]] = await conn.execute('SELECT * FROM coupons WHERE code = ? FOR UPDATE', [input.couponCode.toUpperCase()]);
        const rawSubtotal = lines.reduce((s, l) => s + toCents((map.get(`${l.productId}:${l.variantId || 0}`) || map.get(`${l.productId}:0`)).price) * l.quantity, 0);
        checkCoupon(coupon, rawSubtotal);
      }
      const t = computeTotals(lines, map, zone.fee, coupon);

      // 5) Insert order (retry on the astronomically unlikely order-number collision).
      const publicToken = crypto.randomBytes(16).toString('hex');
      let orderId; let orderNumber;
      for (let attempt = 0; attempt < 5 && !orderId; attempt++) {
        orderNumber = newOrderNumber();
        try {
          const [ins] = await conn.execute(
            `INSERT INTO orders (order_number, public_token, user_id, customer_name, phone, email, governorate, city, address, customer_note,
               subtotal, discount_total, products_total, shipping_fee, grand_total, coupon_id, coupon_code, payment_mode, status, shipping_payment_status, expires_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'awaiting_shipping_payment','unpaid', DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? HOUR))`,
            [orderNumber, publicToken, user?.id ?? null, input.name, input.phone, input.email || null, input.governorate, input.city, input.address, input.note || null,
              fromCents(t.subtotal), fromCents(t.discount), fromCents(t.productsTotal), fromCents(t.shipping), fromCents(t.grand),
              coupon ? coupon.id : null, coupon ? coupon.code : null, input.paymentMode === 'full' ? 'full' : 'shipping_only', windowHours]);
          orderId = ins.insertId;
        } catch (e) { if (e.code !== 'ER_DUP_ENTRY' || !String(e.message).includes('uq_orders_number')) throw e; }
      }
      if (!orderId) throw new Error('could not allocate order number');

      // 6) Items (price snapshot) + atomic conditional stock deduction + movement.
      const stockAfter = [];
      const remainingStock = new Map(rows.map(r => [num(r.id), Number(r.stock_quantity)]));
      for (const l of t.priced) {
        await conn.execute(
          'INSERT INTO order_items (order_id, product_id, variant_id, product_name, brand, size_label, unit_price, quantity, line_total) VALUES (?,?,?,?,?,?,?,?,?)',
          [orderId, l.productId, l.variantId || null, l.product.name, l.product.brand, l.product.size_label, fromCents(l.unit), l.quantity, fromCents(l.lineTotal)]);
        const [upd] = await conn.execute('UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ? AND stock_quantity >= ?', [l.quantity, l.productId, l.quantity]);
        if (upd.affectedRows !== 1) throw conflict(`Only part of the requested quantity of "${l.product.name}" is available`, 'INSUFFICIENT_STOCK', { productId: l.productId });
        const after = (remainingStock.get(l.productId) ?? Number(l.product.stock_quantity)) - l.quantity;
        remainingStock.set(l.productId, after);
        await conn.execute(
          "INSERT INTO inventory_movements (product_id, change_qty, quantity_after, reason, reference_type, reference_id, note) VALUES (?,?,?,'sale','order',?,?)",
          [l.productId, -l.quantity, after, orderId, orderNumber]);
        stockAfter.push({ productId: l.productId, quantity: after });
      }
      if (coupon) {
        const [cu] = await conn.execute('UPDATE coupons SET used_count = used_count + 1 WHERE id = ? AND (max_uses IS NULL OR used_count < max_uses)', [coupon.id]);
        if (cu.affectedRows !== 1) throw unprocessable('This coupon has reached its usage limit', 'INVALID_COUPON');
      }

      await audit(req, 'order.created', 'order', orderId, { orderNumber, total: fromCents(t.grand), items: t.priced.length }, conn);

      const [[row]] = await conn.execute('SELECT * FROM orders WHERE id = ?', [orderId]);
      const view = await presentOrderForCustomer(row, settings, undefined, conn);
      const response = { order: { ...view, trackingToken: publicToken } };
      await conn.execute('UPDATE idempotency_keys SET status_code = 201, response_body = ? WHERE scope = ? AND key_hash = ?', [JSON.stringify(response), scope, keyHash]);
      return { response, orderId, orderNumber, stockAfter };
    });
  } catch (e) {
    if (e instanceof IdempotencyConflict) {
      const [row] = await db.query('SELECT request_hash, status_code, response_body FROM idempotency_keys WHERE scope = ? AND key_hash = ?', [scope, keyHash]);
      if (!row) throw conflict('Request is being processed, please retry shortly', 'IDEMPOTENCY_IN_PROGRESS');
      if (row.request_hash !== requestHash) throw unprocessable('This Idempotency-Key was already used with a different request', 'IDEMPOTENCY_KEY_REUSED');
      if (!row.response_body) throw conflict('Request is being processed, please retry shortly', 'IDEMPOTENCY_IN_PROGRESS');
      const body = typeof row.response_body === 'string' ? JSON.parse(row.response_body) : row.response_body;
      return { replay: true, status: row.status_code || 201, body };
    }
    logger.error('order creation failed', { requestId: req?.id, message: e.message, code: e.code });
    throw e;
  }

  // 7) Real-time events: only after COMMIT, minimal payloads.
  realtime.emit('staff:orders', 'order:created', { orderId: result.orderId, orderNumber: result.orderNumber });
  require('../lib/telegram').notifyNewOrder(result.response.order, input); // optional owner alert; never blocks or fails the order
  for (const s of result.stockAfter) emitStock(s.productId, s.quantity);
  return { replay: false, status: 201, body: result.response };
}

function emitStock(productId, quantity) {
  realtime.emit('staff:inventory', 'inventory:updated', { productId, quantity });
  realtime.emit('public', 'product:updated', { productId });
}

/* ---------------------------- fetch helpers ---------------------------- */
async function getOrderByToken(orderNumber, token) {
  const [o] = await db.query('SELECT * FROM orders WHERE order_number = ?', [orderNumber]);
  if (!o || !safeEqual(o.public_token, token)) throw notFound('Order not found');
  return o;
}
async function lastRejectReason(orderId) {
  const [r] = await db.query("SELECT reject_reason FROM shipping_payments WHERE order_id = ? AND status = 'rejected' ORDER BY id DESC LIMIT 1", [orderId]);
  return r?.reject_reason;
}
async function trackOrder(orderNumber, token) {
  const o = await getOrderByToken(orderNumber, token);
  return presentOrderForCustomer(o, await getSettings(), await lastRejectReason(o.id));
}
async function listOrdersForUser(userId) {
  const rows = await db.query('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 50', [userId]);
  const settings = await getSettings();
  return Promise.all(rows.map(async (o) => presentOrderForCustomer(o, settings, await lastRejectReason(o.id))));
}
async function getOrderForUser(orderNumber, userId) {
  const [o] = await db.query('SELECT * FROM orders WHERE order_number = ? AND user_id = ?', [orderNumber, userId]);
  if (!o) throw notFound('Order not found');
  return presentOrderForCustomer(o, await getSettings(), await lastRejectReason(o.id));
}

/* ---------------------------- shipping payment: customer submits ---------------------------- */
async function submitShippingPayment({ orderNumber, token, reference, amountSent, receipt, req }) {
  const o0 = await getOrderByToken(orderNumber, token);
  const out = await db.withTransaction(async (conn) => {
    const [[o]] = await conn.execute('SELECT * FROM orders WHERE id = ? FOR UPDATE', [o0.id]);
    if (o.status !== 'awaiting_shipping_payment' || !['unpaid', 'rejected'].includes(o.shipping_payment_status)) {
      throw conflict('A shipping payment has already been submitted or this order is not awaiting payment', 'PAYMENT_NOT_ACCEPTED');
    }
    const expectedPayment = o.payment_mode === 'full' ? o.grand_total : o.shipping_fee;
    if (amountSent !== undefined && toCents(amountSent) !== toCents(expectedPayment)) throw unprocessable('Transfer amount must match the selected payment option', 'AMOUNT_MISMATCH');
    try {
      await conn.execute(
        "INSERT INTO shipping_payments (order_id, status, amount_claimed, reference_number, receipt_file, receipt_mime) VALUES (?, 'submitted', ?,?,?,?)",
        [o.id, amountSent ?? (o.payment_mode === 'full' ? o.grand_total : o.shipping_fee), reference || null, receipt?.name || null, receipt?.mime || null]);
    } catch (e) { if (e.code === 'ER_DUP_ENTRY') throw conflict('A shipping payment is already awaiting review', 'PAYMENT_ALREADY_SUBMITTED'); throw e; }
    const [upd] = await conn.execute(
      "UPDATE orders SET status = 'shipping_payment_under_review', shipping_payment_status = 'submitted' WHERE id = ? AND status = 'awaiting_shipping_payment'", [o.id]);
    if (upd.affectedRows !== 1) throw conflict('Order state changed, please retry', 'STATE_CHANGED');
    await audit(req, 'shipping_payment.submitted', 'order', o.id, { orderNumber, hasReceipt: !!receipt, reference: reference || null }, conn);
    return { orderId: num(o.id), orderNumber: o.order_number };
  });
  realtime.emit('staff:payments', 'shippingPayment:submitted', out);
  realtime.emit('staff:orders', 'order:statusChanged', { ...out, status: 'shipping_payment_under_review', shippingPaymentStatus: 'submitted' });
  realtime.emit(`order:${out.orderNumber}`, 'order:statusChanged', { orderNumber: out.orderNumber, status: 'shipping_payment_under_review', shippingPaymentStatus: 'submitted' });
  return trackOrder(orderNumber, token);
}

/* ---------------------------- shipping payment: staff review ---------------------------- */
async function lockOrder(conn, orderId) {
  const [[o]] = await conn.execute('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
  if (!o) throw notFound('Order not found');
  return o;
}
async function lockSubmittedPayment(conn, orderId) {
  const [[p]] = await conn.execute("SELECT * FROM shipping_payments WHERE order_id = ? AND status = 'submitted' ORDER BY id DESC LIMIT 1 FOR UPDATE", [orderId]);
  if (!p) throw conflict('There is no shipping payment awaiting review for this order (it may already be confirmed or rejected)', 'NO_PENDING_PAYMENT');
  return p;
}

async function confirmShippingPayment({ orderId, amount, note, req }) {
  const out = await db.withTransaction(async (conn) => {
    const o = await lockOrder(conn, orderId);
    if (o.status !== 'shipping_payment_under_review' || o.shipping_payment_status !== 'submitted') {
      throw conflict('Shipping payment is not awaiting review', 'NO_PENDING_PAYMENT');
    }
    const p = await lockSubmittedPayment(conn, o.id);
    const expectedPayment = o.payment_mode === 'full' ? o.grand_total : o.shipping_fee;
    if (toCents(amount) !== toCents(expectedPayment)) {
      throw unprocessable(`Transferred amount (${amount}) does not match the expected payment (${expectedPayment}). Reject the transfer or ask the customer to pay the difference.`, 'AMOUNT_MISMATCH', { expected: num(expectedPayment) });
    }
    const [u1] = await conn.execute("UPDATE shipping_payments SET status='confirmed', reviewed_by=?, reviewed_at=UTC_TIMESTAMP(), confirmed_amount=? WHERE id=? AND status='submitted'", [req.user.id, fromCents(toCents(amount)), p.id]);
    const [u2] = await conn.execute("UPDATE orders SET status='confirmed', shipping_payment_status='confirmed' WHERE id=? AND status='shipping_payment_under_review' AND shipping_payment_status='submitted'", [o.id]);
    if (u1.affectedRows !== 1 || u2.affectedRows !== 1) throw conflict('Already processed', 'ALREADY_PROCESSED');
    await audit(req, 'shipping_payment.confirmed', 'order', o.id, { orderNumber: o.order_number, amount: fromCents(toCents(amount)), paymentId: num(p.id), note: note || null }, conn);
    return { orderId: num(o.id), orderNumber: o.order_number };
  });
  realtime.emit('staff:payments', 'shippingPayment:confirmed', out);
  realtime.emit('staff:orders', 'order:statusChanged', { ...out, status: 'confirmed', shippingPaymentStatus: 'confirmed' });
  realtime.emit(`order:${out.orderNumber}`, 'shippingPayment:confirmed', { orderNumber: out.orderNumber, status: 'confirmed', shippingPaymentStatus: 'confirmed' });
  return out;
}

async function rejectShippingPayment({ orderId, reason, req }) {
  const settings = await getSettings();
  const windowHours = Math.max(1, Number(settings.shipping_payment_window_hours || 48));
  const out = await db.withTransaction(async (conn) => {
    const o = await lockOrder(conn, orderId);
    if (o.status !== 'shipping_payment_under_review' || o.shipping_payment_status !== 'submitted') {
      throw conflict('Shipping payment is not awaiting review', 'NO_PENDING_PAYMENT');
    }
    const p = await lockSubmittedPayment(conn, o.id);
    const [u1] = await conn.execute("UPDATE shipping_payments SET status='rejected', reviewed_by=?, reviewed_at=UTC_TIMESTAMP(), reject_reason=? WHERE id=? AND status='submitted'", [req.user.id, reason, p.id]);
    const [u2] = await conn.execute("UPDATE orders SET status='awaiting_shipping_payment', shipping_payment_status='rejected', expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? HOUR) WHERE id=? AND status='shipping_payment_under_review'", [windowHours, o.id]);
    if (u1.affectedRows !== 1 || u2.affectedRows !== 1) throw conflict('Already processed', 'ALREADY_PROCESSED');
    await audit(req, 'shipping_payment.rejected', 'order', o.id, { orderNumber: o.order_number, reason, paymentId: num(p.id) }, conn);
    return { orderId: num(o.id), orderNumber: o.order_number };
  });
  realtime.emit('staff:payments', 'shippingPayment:rejected', out);
  realtime.emit('staff:orders', 'order:statusChanged', { ...out, status: 'awaiting_shipping_payment', shippingPaymentStatus: 'rejected' });
  realtime.emit(`order:${out.orderNumber}`, 'shippingPayment:rejected', { orderNumber: out.orderNumber, status: 'awaiting_shipping_payment', shippingPaymentStatus: 'rejected' });
  return out;
}

/* ---------------------------- status changes + stock restore ---------------------------- */
/** Returns stock for a cancelled order exactly once (guarded by orders.stock_restored AND the unique movement key). */
async function restockOrder(conn, order, reason, req) {
  const [g] = await conn.execute('UPDATE orders SET stock_restored = 1 WHERE id = ? AND stock_restored = 0', [order.id]);
  if (g.affectedRows !== 1) return [];
  const [items] = await conn.execute('SELECT product_id, quantity FROM order_items WHERE order_id = ? ORDER BY product_id', [order.id]);
  const changed = [];
  for (const it of items) {
    await conn.execute('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?', [it.quantity, it.product_id]);
    const [[p]] = await conn.execute('SELECT stock_quantity FROM products WHERE id = ?', [it.product_id]);
    await conn.execute(
      "INSERT INTO inventory_movements (product_id, change_qty, quantity_after, reason, reference_type, reference_id, note, user_id) VALUES (?,?,?,'cancel_restock','order',?,?,?)",
      [it.product_id, it.quantity, p.stock_quantity, order.id, reason, req?.user?.id ?? null]);
    changed.push({ productId: num(it.product_id), quantity: p.stock_quantity });
  }
  return changed;
}

async function changeStatus({ orderId, to, reason, req, system = false }) {
  const out = await db.withTransaction(async (conn) => {
    const o = await lockOrder(conn, orderId);
    if (!system && !MANUAL_TARGETS.has(to)) {
      throw unprocessable(to === 'confirmed' ? 'An order can only be confirmed by reviewing its shipping payment' : `Status "${to}" cannot be set manually`, 'INVALID_TRANSITION');
    }
    if (!(TRANSITIONS[o.status] || []).includes(to)) throw conflict(`Cannot change order from "${o.status}" to "${to}"`, 'INVALID_TRANSITION', { from: o.status, to });
    if ((to === 'processing' || to === 'shipped') && o.shipping_payment_status !== 'confirmed') {
      throw unprocessable('Shipping payment must be confirmed before the order can be processed or shipped', 'SHIPPING_PAYMENT_NOT_CONFIRMED');
    }
    let restocked = [];
    if (to === 'cancelled') restocked = await restockOrder(conn, o, 'order cancelled', req);
    const [u] = await conn.execute('UPDATE orders SET status = ?, cancel_reason = ? WHERE id = ? AND status = ?', [to, to === 'cancelled' ? (reason || null) : o.cancel_reason, o.id, o.status]);
    if (u.affectedRows !== 1) throw conflict('Order state changed, please retry', 'STATE_CHANGED');
    await audit(req, system ? 'order.auto_cancelled' : 'order.status_changed', 'order', o.id, { orderNumber: o.order_number, from: o.status, to, reason: reason || null, restocked: restocked.length }, conn);
    return { orderId: num(o.id), orderNumber: o.order_number, status: to, shippingPaymentStatus: o.shipping_payment_status,
    paymentMode: o.payment_mode || 'shipping_only', restocked };
  });
  const { restocked, ...payload } = out;
  realtime.emit('staff:orders', 'order:statusChanged', payload);
  realtime.emit(`order:${payload.orderNumber}`, 'order:statusChanged', { orderNumber: payload.orderNumber, status: payload.status, shippingPaymentStatus: payload.shippingPaymentStatus });
  for (const s of restocked) emitStock(s.productId, s.quantity);
  return payload;
}

/** Cash-on-delivery collection is recorded explicitly: "delivered" does NOT mean the money was collected. */
async function recordCod({ orderId, collected, amount, req }) {
  const out = await db.withTransaction(async (conn) => {
    const o = await lockOrder(conn, orderId);
    if (o.status !== 'delivered') throw conflict('COD can only be recorded for delivered orders', 'INVALID_STATE');
    if (o.cod_status !== 'pending') throw conflict('COD collection was already recorded', 'ALREADY_PROCESSED');
    if (o.payment_mode === 'full') throw conflict('This order was paid in full; no COD is due', 'NO_COD_DUE');
    if (collected && toCents(amount) !== toCents(o.products_total)) {
      throw unprocessable(`Collected amount must equal the COD amount (${o.products_total})`, 'AMOUNT_MISMATCH', { expected: num(o.products_total) });
    }
    const [u] = await conn.execute(
      "UPDATE orders SET cod_status = ?, cod_amount_collected = ?, cod_collected_at = IF(?, UTC_TIMESTAMP(), NULL), cod_collected_by = ? WHERE id = ? AND cod_status = 'pending'",
      [collected ? 'collected' : 'not_collected', collected ? fromCents(toCents(amount)) : null, collected ? 1 : 0, req.user.id, o.id]);
    if (u.affectedRows !== 1) throw conflict('Already processed', 'ALREADY_PROCESSED');
    await audit(req, collected ? 'order.cod_collected' : 'order.cod_not_collected', 'order', o.id, { orderNumber: o.order_number, amount: collected ? amount : null }, conn);
    return { orderId: num(o.id), orderNumber: o.order_number };
  });
  realtime.emit('staff:orders', 'order:updated', out);
  realtime.emit(`order:${out.orderNumber}`, 'order:updated', { orderNumber: out.orderNumber });
  return out;
}

/** Auto-cancel orders whose shipping payment window expired (returns the stock). Safe to run on every instance. */
async function expireUnpaidOrders() {
  const rows = await db.query("SELECT id FROM orders WHERE status = 'awaiting_shipping_payment' AND expires_at IS NOT NULL AND expires_at < UTC_TIMESTAMP() ORDER BY id LIMIT 50");
  let n = 0;
  for (const r of rows) {
    try { await changeStatus({ orderId: r.id, to: 'cancelled', reason: 'Shipping payment window expired', req: { id: 'sweeper' }, system: true }); n++; }
    catch (e) { if (e.code !== 'INVALID_TRANSITION' && e.code !== 'STATE_CHANGED') logger.error('expiry sweep failed', { orderId: r.id, message: e.message }); }
  }
  return n;
}

/* ---------------------------- staff queries ---------------------------- */
const STATUS_LIST = Object.keys(TRANSITIONS);
async function listOrders({ status, paymentStatus, q, page = 1, limit = 25 }) {
  const where = ['1=1']; const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (paymentStatus) { where.push('shipping_payment_status = ?'); params.push(paymentStatus); }
  if (q) { const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`; where.push('(order_number LIKE ? OR customer_name LIKE ? OR phone LIKE ?)'); params.push(like, like, like); }
  const [{ total }] = await db.query(`SELECT COUNT(*) AS total FROM orders WHERE ${where.join(' AND ')}`, params);
  const rows = await db.query(
    `SELECT id, order_number, customer_name, phone, governorate, status, shipping_payment_status, payment_mode, cod_status, grand_total, created_at FROM orders WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ${Number(limit)} OFFSET ${Number((page - 1) * limit)}`, params);
  return { items: rows.map((o) => ({ id: num(o.id), orderNumber: o.order_number, customerName: o.customer_name, phone: o.phone, governorate: o.governorate, status: o.status, shippingPaymentStatus: o.shipping_payment_status,
    paymentMode: o.payment_mode || 'shipping_only', codStatus: o.cod_status, grandTotal: num(o.grand_total), createdAt: o.created_at })), page, limit, total: num(total) };
}
async function getOrderForStaff(id) {
  const [o] = await db.query('SELECT * FROM orders WHERE id = ?', [id]);
  if (!o) throw notFound('Order not found');
  const view = await presentOrderForStaff(o);
  const history = await db.query("SELECT a.action, a.details, a.created_at, u.name AS actor FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE a.entity_type = 'order' AND a.entity_id = ? ORDER BY a.id DESC LIMIT 50", [String(id)]);
  view.history = history.map((h) => ({ action: h.action, actor: h.actor || 'system/customer', at: h.created_at, details: typeof h.details === 'string' ? JSON.parse(h.details) : h.details }));
  return view;
}

module.exports = {
  TRANSITIONS, MANUAL_TARGETS, STATUS_LIST, computeTotals, mergeLines, emitStock,
  quote, createOrder, trackOrder, listOrdersForUser, getOrderForUser, submitShippingPayment,
  confirmShippingPayment, rejectShippingPayment, changeStatus, recordCod, expireUnpaidOrders, listOrders, getOrderForStaff,
};
