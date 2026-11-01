-- Product size variants and storefront contact settings. Safe to run once via the migration runner.
CREATE TABLE product_variants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id BIGINT UNSIGNED NOT NULL,
  size_label VARCHAR(40) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  compare_at_price DECIMAL(10,2) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_product_variant_size (product_id, size_label),
  KEY idx_variant_product_active (product_id, is_active, sort_order),
  CONSTRAINT fk_variant_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT chk_variant_price CHECK (price >= 0),
  CONSTRAINT chk_variant_compare_price CHECK (compare_at_price IS NULL OR compare_at_price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO product_variants (product_id, size_label, price, compare_at_price, sort_order)
SELECT id, COALESCE(NULLIF(size_label, ''), 'Standard'), price, compare_at_price, 0
FROM products WHERE deleted_at IS NULL
ON DUPLICATE KEY UPDATE price = VALUES(price);

ALTER TABLE order_items ADD COLUMN variant_id BIGINT UNSIGNED NULL AFTER product_id;
ALTER TABLE order_items DROP INDEX uq_order_product;
ALTER TABLE order_items ADD UNIQUE KEY uq_order_product_variant (order_id, product_id, variant_id);
ALTER TABLE order_items ADD KEY idx_items_variant (variant_id);
ALTER TABLE order_items ADD CONSTRAINT fk_items_variant FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL;
