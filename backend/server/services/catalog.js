'use strict';
const db = require('../lib/db');
const { notFound } = require('../lib/errors');

async function getSettings() {
  const rows = await db.query('SELECT key_name, value FROM settings');
  return Object.fromEntries(rows.map((r) => [r.key_name, r.value]));
}

function presentProduct(r, lowThreshold = 3, variants = []) {
  const stock = Number(r.stock_quantity);
  return {
    id: Number(r.id), slug: r.slug, name: r.name, brand: r.brand, category: r.category_name,
    family: r.family || '', notes: r.fragrance_notes || '', size: r.size_label || '', price: Number(r.price),
    compareAtPrice: r.compare_at_price === null ? null : Number(r.compare_at_price),
    tag: r.tag || '', description: r.description || '', image: r.image_url || '',
    inStock: stock > 0, lowStock: stock > 0 && stock <= lowThreshold, maxQty: Math.min(50, stock),
    variants: variants.map((v) => ({ id: Number(v.id), size: v.size_label, price: Number(v.price), compareAtPrice: v.compare_at_price == null ? null : Number(v.compare_at_price), isActive: !!v.is_active })).filter((v) => v.isActive),
  };
}

// Allowlist: ORDER BY cannot be parameterized, so only these fixed fragments are ever interpolated.
const SORTS = {
  featured: 'p.sort_order ASC, p.id ASC',
  low: 'p.price ASC, p.id ASC',
  high: 'p.price DESC, p.id ASC',
  name: 'p.name ASC, p.id ASC',
};
const escapeLike = (s) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

async function listProducts({ category, q, sort = 'featured', page = 1, limit = 24 }) {
  const where = ['p.is_active = 1', 'p.deleted_at IS NULL'];
  const params = [];
  if (category && category !== 'All') { where.push('c.name = ?'); params.push(category); }
  if (q) {
    where.push('(p.name LIKE ? OR p.family LIKE ? OR p.brand LIKE ? OR c.name LIKE ? OR p.fragrance_notes LIKE ?)');
    const like = `%${escapeLike(q)}%`; params.push(like, like, like, like, like);
  }
  const orderBy = SORTS[sort] || SORTS.featured;
  const base = `FROM products p JOIN categories c ON c.id = p.category_id WHERE ${where.join(' AND ')}`;
  const [{ total }] = await db.query(`SELECT COUNT(*) AS total ${base}`, params);
  const off = (page - 1) * limit;
  const rows = await db.query(
    `SELECT p.*, c.name AS category_name ${base} ORDER BY ${orderBy} LIMIT ${Number(limit)} OFFSET ${Number(off)}`, params);
  const settings = await getSettings();
  const low = Number(settings.low_stock_threshold || 3);
  const variants = rows.length ? await db.query(`SELECT * FROM product_variants WHERE is_active = 1 AND product_id IN (${rows.map(() => '?').join(',')}) ORDER BY sort_order, id`, rows.map((r) => r.id)) : [];
  const byProduct = new Map(); for (const v of variants) { const k = Number(v.product_id); if (!byProduct.has(k)) byProduct.set(k, []); byProduct.get(k).push(v); }
  return { items: rows.map((r) => presentProduct(r, low, byProduct.get(Number(r.id)) || [])), page, limit, total: Number(total) };
}

async function getProduct(id) {
  const rows = await db.query(
    'SELECT p.*, c.name AS category_name FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ? AND p.is_active = 1 AND p.deleted_at IS NULL', [id]);
  if (!rows[0]) throw notFound('Product not found');
  const settings = await getSettings();
  const variants = await db.query('SELECT * FROM product_variants WHERE product_id = ? AND is_active = 1 ORDER BY sort_order, id', [id]);
  return presentProduct(rows[0], Number(settings.low_stock_threshold || 3), variants);
}

async function getConfig() {
  const [settings, categories, zones] = await Promise.all([
    getSettings(),
    db.query('SELECT name FROM categories ORDER BY sort_order, id'),
    db.query('SELECT governorate, fee FROM shipping_zones WHERE is_active = 1 ORDER BY governorate'),
  ]);
  return {
    storeName: settings.store_name || 'ELZEMITY',
    contact: { whatsapp: settings.contact_whatsapp || '', whatsappEnabled: settings.contact_whatsapp_enabled !== '0', socialAccounts: (() => { try { return JSON.parse(settings.social_accounts || '[]').filter((x) => x && x.enabled && /^https?:\/\//i.test(x.url || '')); } catch { return []; } })() },
    paymentPolicy: { method: 'instapay', shippingPrepaid: true, fullAdvanceEnabled: settings.full_advance_enabled === '1', manualReview: true },
    checkoutNotesEnabled: true,
    categories: categories.map((c) => c.name),
    shippingZones: zones.map((z) => ({ governorate: z.governorate, fee: Number(z.fee) })),
  };
}
module.exports = { getSettings, presentProduct, listProducts, getProduct, getConfig };
