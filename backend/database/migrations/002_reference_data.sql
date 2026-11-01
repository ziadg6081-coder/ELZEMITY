-- 002_reference_data.sql : roles, permissions, categories, shipping zones, settings (required reference data, NOT sample data)

INSERT INTO roles (id, name, description) VALUES
 (1,'customer','Storefront customer'),
 (2,'admin','Full access'),
 (3,'inventory_manager','Manages products and stock'),
 (4,'order_manager','Manages orders and shipping payment review');

INSERT INTO permissions (code, description) VALUES
 ('products.manage','Create/update/delete products'),
 ('inventory.manage','Adjust stock'),
 ('orders.view','View orders'),
 ('orders.manage','Change order status, COD collection'),
 ('shipping_payments.review','Confirm or reject InstaPay shipping transfers'),
 ('users.manage','Manage staff accounts and roles'),
 ('audit.view','View audit logs'),
 ('settings.manage','Manage shipping zones, coupons, settings');

-- admin: everything
INSERT INTO role_permissions (role_id, permission_id) SELECT 2, id FROM permissions;
-- inventory manager
INSERT INTO role_permissions (role_id, permission_id) SELECT 3, id FROM permissions WHERE code IN ('products.manage','inventory.manage','orders.view');
-- order manager
INSERT INTO role_permissions (role_id, permission_id) SELECT 4, id FROM permissions WHERE code IN ('orders.view','orders.manage','shipping_payments.review');

INSERT INTO categories (name, slug, sort_order) VALUES ('Men','men',1),('Women','women',2),('Unisex','unisex',3);

-- Shipping fees are PLACEHOLDERS: the owner must review/edit them (Admin > Shipping zones) before launch.
INSERT INTO shipping_zones (governorate, fee) VALUES
 ('Cairo',50),('Giza',50),('Alexandria',65),('Qalyubia',55),('Sharqia',65),('Dakahlia',65),('Gharbia',65),
 ('Monufia',65),('Beheira',65),('Kafr El Sheikh',70),('Damietta',70),('Port Said',70),('Ismailia',70),('Suez',70),
 ('Fayoum',70),('Beni Suef',75),('Minya',80),('Assiut',85),('Sohag',90),('Qena',95),('Luxor',100),('Aswan',105),
 ('Red Sea',110),('New Valley',120),('Matrouh',110),('North Sinai',120),('South Sinai',120);

INSERT INTO settings (key_name, value) VALUES
 ('store_name','ORIANTAL PERFUMES'),
 ('instapay_handle',''),                 -- owner must set this in Admin > Settings; shown to customers only after order creation
 ('instapay_account_name',''),
 ('shipping_payment_window_hours','48'), -- unpaid orders are auto-cancelled and stock is returned after this
 ('low_stock_threshold','3');
