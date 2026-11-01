'use strict';
const express = require('express');
const { z } = require('zod');
const catalog = require('../services/catalog');
const orders = require('../services/orders');
const { validate } = require('../middleware/core');
const limits = require('../middleware/limits');
const { requireAuth } = require('../middleware/auth');
const { receiptUpload, saveReceipt, removeReceipt } = require('../middleware/upload');
const { badRequest } = require('../lib/errors');

const router = express.Router();

router.get('/config', async (req, res, next) => { try { res.json(await catalog.getConfig()); } catch (e) { next(e); } });

const listSchema = z.object({
  category: z.string().trim().max(40).optional(),
  q: z.string().trim().max(80).optional(),
  sort: z.enum(['featured', 'low', 'high', 'name']).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(60).optional(),
});
router.get('/products', validate(listSchema, 'query'), async (req, res, next) => {
  try { res.json(await catalog.listProducts(req.query)); } catch (e) { next(e); }
});
router.get('/products/:id', async (req, res, next) => {
  try {
    if (!/^\d{1,12}$/.test(req.params.id)) throw badRequest('Invalid product id');
    res.json({ product: await catalog.getProduct(Number(req.params.id)) });
  } catch (e) { next(e); }
});

/* ---- orders ---- */
const itemsSchema = z.array(z.strictObject({
  productId: z.number().int().positive(),
  variantId: z.number().int().positive().optional(),
  quantity: z.number().int().min(1).max(50),
})).min(1).max(20);

const quoteSchema = z.strictObject({
  items: itemsSchema,
  governorate: z.string().trim().max(60).optional(),
  couponCode: z.string().trim().max(40).optional(),
});
router.post('/quote', limits.lookup, validate(quoteSchema), async (req, res, next) => {
  try { res.json({ quote: await orders.quote(req.body) }); } catch (e) { next(e); }
});

// NOTE: strictObject => any client-supplied price / discount / shipping / status / userId field is rejected (mass assignment protection).
const createOrderSchema = z.strictObject({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^[0-9+()\s-]{8,20}$/, 'Invalid phone number'),
  email: z.string().trim().toLowerCase().pipe(z.email().max(190)).optional().or(z.literal('').transform(() => undefined)),
  governorate: z.string().trim().min(2).max(60),
  city: z.string().trim().min(2).max(100),
  address: z.string().trim().min(5).max(500),
  note: z.string().trim().max(1000).optional(),
  couponCode: z.string().trim().max(40).optional().or(z.literal('').transform(() => undefined)),
  paymentMode: z.enum(['shipping_only','full']).default('shipping_only'),
  items: itemsSchema,
});
router.post('/orders', limits.createOrder, validate(createOrderSchema), async (req, res, next) => {
  try {
    const key = req.get('idempotency-key');
    if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) throw badRequest('A valid Idempotency-Key header (16-128 chars) is required');
    const r = await orders.createOrder({ input: req.body, user: req.user, idemKey: key, req });
    if (r.replay) res.set('Idempotent-Replay', 'true');
    res.status(r.status).json(r.body);
  } catch (e) { next(e); }
});

const orderNumberParam = (req, res, next) => (/^OP-\d{6}-[A-Z0-9]{6}$/.test(req.params.orderNumber) ? next() : next(badRequest('Invalid order number')));
const tokenHeader = (req) => {
  const t = req.get('x-order-token');
  if (!t || !/^[a-f0-9]{32}$/.test(t)) throw badRequest('Missing or invalid X-Order-Token header');
  return t;
};

router.get('/orders/:orderNumber', limits.lookup, orderNumberParam, async (req, res, next) => {
  try {
    if (req.user && !req.get('x-order-token')) return res.json({ order: await orders.getOrderForUser(req.params.orderNumber, req.user.id) });
    return res.json({ order: await orders.trackOrder(req.params.orderNumber, tokenHeader(req)) });
  } catch (e) { next(e); }
});

router.post('/orders/:orderNumber/shipping-payment', limits.upload, orderNumberParam, receiptUpload, async (req, res, next) => {
  let saved;
  try {
    const token = tokenHeader(req);
    const body = z.strictObject({
      reference: z.string().trim().max(80).optional(),
      amountSent: z.coerce.number().positive().max(99999999.99).optional(),
    }).safeParse({ ...(req.body.reference ? { reference: req.body.reference } : {}), ...(req.body.amountSent ? { amountSent: req.body.amountSent } : {}) });
    if (!body.success) throw badRequest('Invalid payment details');
    if (!req.file && !body.data.reference) throw badRequest('Attach a screenshot of the transfer or enter the InstaPay reference number');
    if (req.file) saved = await saveReceipt(req.file);
    const order = await orders.submitShippingPayment({ orderNumber: req.params.orderNumber, token, reference: body.data.reference, amountSent: body.data.amountSent === undefined ? undefined : body.data.amountSent.toFixed(2), receipt: saved, req });
    res.status(201).json({ order });
  } catch (e) {
    if (saved) await removeReceipt(saved.name); // no orphan files when the DB step fails
    next(e);
  }
});

router.post('/newsletter', limits.register, validate(z.strictObject({ email: z.string().trim().toLowerCase().pipe(z.email().max(190)) })), async (req, res, next) => {
  try {
    const r = await require('../lib/db').query('INSERT IGNORE INTO newsletter_subscribers (email) VALUES (?)', [req.body.email]);
    if (r.affectedRows === 1) require('../lib/realtime').emit('staff:newsletter', 'newsletter:subscribed', {}); // no email in the payload; staff re-fetch via the API
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

router.get('/me/orders', requireAuth, async (req, res, next) => {
  try { res.json({ items: await orders.listOrdersForUser(req.user.id) }); } catch (e) { next(e); }
});

module.exports = router;
