'use strict';
/**
 * Idempotent repair for order_items variant support (migration 005 can stop half-way on MySQL/MariaDB because
 * uq_order_product is the only index serving the order_id foreign key, so DROP INDEX fails).
 * Safe to run any number of times:  node scripts/repair-order-items.js
 */
const { connect } = require('./lib');

(async () => {
  const conn = await connect();
  const [[{ db }]] = await conn.query('SELECT DATABASE() AS db');
  const has = async (sql, p) => (await conn.query(sql, p))[0].length > 0;
  const col = await has("SELECT 1 FROM information_schema.columns WHERE table_schema=? AND table_name='order_items' AND column_name='variant_id'", [db]);
  const idx = (n) => has("SELECT 1 FROM information_schema.statistics WHERE table_schema=? AND table_name='order_items' AND index_name=?", [db, n]);
  const fk = await has("SELECT 1 FROM information_schema.table_constraints WHERE table_schema=? AND table_name='order_items' AND constraint_name='fk_items_variant'", [db]);

  if (!col) { await conn.query('ALTER TABLE order_items ADD COLUMN variant_id BIGINT UNSIGNED NULL AFTER product_id'); console.log('+ added order_items.variant_id'); }
  if (!(await idx('uq_order_product_variant'))) { await conn.query('ALTER TABLE order_items ADD UNIQUE KEY uq_order_product_variant (order_id, product_id, variant_id)'); console.log('+ added uq_order_product_variant'); }
  if (await idx('uq_order_product')) { await conn.query('ALTER TABLE order_items DROP INDEX uq_order_product'); console.log('+ dropped old uq_order_product'); }
  if (!(await idx('idx_items_variant'))) { await conn.query('ALTER TABLE order_items ADD KEY idx_items_variant (variant_id)'); console.log('+ added idx_items_variant'); }
  if (!fk) { await conn.query('ALTER TABLE order_items ADD CONSTRAINT fk_items_variant FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL'); console.log('+ added fk_items_variant'); }

  // make sure every live product has at least one variant row
  const [r] = await conn.query(`INSERT INTO product_variants (product_id, size_label, price, compare_at_price, sort_order)
    SELECT p.id, COALESCE(NULLIF(p.size_label,''),'Standard'), p.price, p.compare_at_price, 0 FROM products p
    WHERE p.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id)`);
  if (r.affectedRows) console.log(`+ created default variant for ${r.affectedRows} product(s)`);
  console.log('order_items is OK.');
  await conn.end();
})().catch((e) => { console.error('Repair failed:', e.message); process.exit(1); });
