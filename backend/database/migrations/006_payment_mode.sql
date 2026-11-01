ALTER TABLE orders ADD COLUMN payment_mode ENUM('shipping_only','full') NOT NULL DEFAULT 'shipping_only' AFTER shipping_payment_status;
