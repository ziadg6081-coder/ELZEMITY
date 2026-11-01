'use strict';
// Read-only, DB-free smoke checks for the upgrade. Run: node --test qa/upgrade-smoke.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.NODE_ENV = 'test';
const db = require('../backend/server/lib/db');
const catalog = require('../backend/server/services/catalog');
const orders = require('../backend/server/services/orders');
const product = {id:1,name:'Test Oud',brand:'ELZEMITY',image_url:'/media/test.png',size_label:'50ml',price:'100.00',stock_quantity:7,is_active:1,deleted_at:null,fragrance_notes:'Rose, Oud'};
const variant = {variant_id:12,product_id:1,id:1,name:product.name,brand:product.brand,image_url:product.image_url,size_label:'100ml',variant_price:'180.00',variant_active:1,is_active:1,deleted_at:null,stock_quantity:7};
const originalQuery = db.query;
async function withMock(fn, action) {
  db.query = async (sql, params) => {
    if (sql.includes('FROM product_variants v JOIN products')) return [variant];
    if (sql.includes('FROM products WHERE id IN')) return [product];
    if (sql.includes('FROM shipping_zones')) return [{fee:'35.00'}];
    if (sql.includes('FROM coupons')) return [{is_active:1, discount_type:'percent',discount_value:'10',min_subtotal:'0',expires_at:null,max_uses:null,used_count:0}];
    if (sql.includes('FROM settings')) return [{key_name:'full_advance_enabled',value:'0'}];
    if (sql.includes('FROM categories')) return [{name:'Unisex'}];
    if (sql.includes('FROM shipping_zones')) return [{governorate:'Cairo',fee:'35.00'}];
    throw Error('Unexpected SQL: '+sql);
  };
  try { await action(); } finally { db.query=originalQuery; }
}
test('product presenter preserves existing stock policy and includes notes/variants', () => {
 const p = catalog.presentProduct(product, 3, [{id:12,size_label:'100ml',price:'180.00',is_active:1}]);
 assert.equal(p.notes,'Rose, Oud');assert.equal(p.inStock,true);assert.equal(p.maxQty,7);
 assert.equal(p.variants[0].price,180);
 assert.equal(p.stock_quantity,undefined);
});
test('server quote uses selected variant price, coupon and shipping', async () => {
 await withMock(null, async () => {
   const q=await orders.quote({items:[{productId:1,variantId:12,quantity:2}],governorate:'Cairo',couponCode:'SAVE10'});
   assert.equal(q.subtotal,360);assert.equal(q.discount,36);assert.equal(q.shippingFee,35);assert.equal(q.grandTotal,359);
   assert.equal(q.items[0].size,'100ml');assert.equal(q.items[0].unitPrice,180);
 });
});
test('server rejects a mismatched product/variant ID', async () => {
 await withMock(null, async () => {
  await assert.rejects(orders.quote({items:[{productId:2,variantId:12,quantity:1}]}), /Invalid product variant/);
 });
});
test('server quote rejects combined quantities beyond product stock', async () => {
 await withMock(null, async () => {
  await assert.rejects(orders.quote({items:[{productId:1,quantity:5},{productId:1,variantId:12,quantity:3}]}), /Only 7 left/);
 });
});
