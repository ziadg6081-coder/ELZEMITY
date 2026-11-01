'use strict';
/** Loads the 8 sample perfumes from the original prototype. Skips if products already exist. SAMPLE DATA - replace from the admin panel. */
const mysql = require('mysql2/promise');
const config = require('../server/config');

const IMG = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=800&q=80`;
const PRODUCTS = [
  ['Amber No. 08', 'Unisex', 'Amber · Woody', '50 ml', 1450, 'Bestseller', IMG('photo-1594035910387-fea47794261f'), 'Warm amber, soft woods and a quiet, enveloping finish. A considered scent for evenings and moments worth remembering.'],
  ['Rose Veil', 'Women', 'Floral · Musk', '50 ml', 1280, 'New', IMG('photo-1592945403244-b3fbafd7f539'), 'A graceful floral impression with a soft, modern character. Delicate without disappearing.'],
  ['Noir Woods', 'Men', 'Woody · Spicy', '100 ml', 1890, 'Signature', IMG('photo-1615634260167-c8cdede054de'), 'Deep woods meet a refined spice accord for a confident, understated signature.'],
  ['Citrus Reverie', 'Unisex', 'Citrus · Fresh', '50 ml', 1120, 'Fresh', IMG('photo-1590736969955-71cc94901144'), 'Bright citrus notes and a clean, airy impression made for easy everyday wear.'],
  ['Velvet Bloom', 'Women', 'Floral · Amber', '75 ml', 1640, 'Popular', IMG('photo-1608571423902-eed4a5ad8108'), 'A velvety floral character softened by warm amber tones. Elegant, expressive, and easy to make your own.'],
  ['Cedar Dusk', 'Men', 'Woody · Aromatic', '100 ml', 1750, 'Classic', IMG('photo-1595425970377-c9703cf48b6d'), 'Crisp aromatic notes settle into a grounded cedarwood finish with a calm, timeless feel.'],
  ['Soft Musk', 'Unisex', 'Musk · Clean', '50 ml', 990, 'Everyday', IMG('photo-1590156221428-6a6a7a7a4d15'), 'A close-to-the-skin musk with a clean, soft character that layers beautifully with other scents.'],
  ['Golden Hour', 'Women', 'Gourmand · Amber', '75 ml', 1590, "Editor's pick", IMG('photo-1594035910387-fea47794261f'), 'A warm, inviting fragrance inspired by the last golden light of the day.'],
];
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function seed(conn, stock = 25) {
  const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM products');
  if (n > 0) return 0;
  const [cats] = await conn.query('SELECT id, name FROM categories');
  const cat = Object.fromEntries(cats.map((c) => [c.name, c.id]));
  let i = 0;
  for (const [name, c, family, size, price, tag, image, description] of PRODUCTS) {
    const [r] = await conn.query('INSERT INTO products (slug, name, brand, category_id, family, size_label, price, tag, description, image_url, stock_quantity, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [slug(name), name, 'ELZEMITY', cat[c], family, size, price.toFixed(2), tag, description, image, stock, ++i]);
    await conn.query("INSERT INTO inventory_movements (product_id, change_qty, quantity_after, reason, reference_type, reference_id, note) VALUES (?,?,?,'initial','product',?,'sample seed')", [r.insertId, stock, stock, r.insertId]);
  }
  return PRODUCTS.length;
}
module.exports = { seed };

if (require.main === module) {
  (async () => {
    const conn = await mysql.createConnection({ host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password, database: config.db.database });
    const n = await seed(conn);
    console.log(n ? `Seeded ${n} sample products (25 in stock each). Edit them from the admin panel.` : 'Products already exist - nothing seeded.');
    await conn.end();
  })().catch((e) => { console.error('Seed failed:', e.message); process.exit(1); });
}
