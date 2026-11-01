-- Optional one-time brand update on the EXISTING database.
-- Back up your database before running this. No schema, users, passwords, or orders are changed.
-- Select your existing database in MySQL Workbench first.
UPDATE settings SET value = 'ELZEMITY' WHERE key_name = 'store_name';
-- Only products whose brand was exactly the former store brand are renamed:
UPDATE products SET brand = 'ELZEMITY' WHERE brand = 'ORIANTAL PERFUMES';
