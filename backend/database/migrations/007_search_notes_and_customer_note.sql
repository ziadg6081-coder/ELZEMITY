-- Apply to a restored TEST database first; never change previously applied migrations.
-- Existing product and order rows remain unchanged. Empty new columns are intentional.
ALTER TABLE products ADD COLUMN fragrance_notes VARCHAR(1000) NULL AFTER family;
ALTER TABLE orders ADD COLUMN customer_note VARCHAR(1000) NULL AFTER address;
-- Current LIKE search supports Arabic and partial words; this index helps regular browse filters.
CREATE INDEX idx_products_active_sort ON products (is_active, deleted_at, sort_order, id);
