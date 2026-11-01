-- Run ONCE as MySQL root (production). Creates the database and a LEAST-PRIVILEGE application user.
-- 1) Replace CHANGE_ME_STRONG_PASSWORD with a long random password. 2) Put the same value in .env (DB_USER / DB_PASSWORD).
CREATE DATABASE IF NOT EXISTS oriantal_perfumes CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Application account: data access only (no DDL, no GRANT, no FILE).
CREATE USER IF NOT EXISTS 'oriantal_app'@'localhost' IDENTIFIED BY 'CHANGE_ME_STRONG_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE ON oriantal_perfumes.* TO 'oriantal_app'@'localhost';

-- Migration account: schema changes only, used by `npm run migrate` via DB_MIGRATION_USER (optional but recommended).
CREATE USER IF NOT EXISTS 'oriantal_migrator'@'localhost' IDENTIFIED BY 'CHANGE_ME_ANOTHER_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON oriantal_perfumes.* TO 'oriantal_migrator'@'localhost';

-- Backup account: read-only dump rights.
CREATE USER IF NOT EXISTS 'oriantal_backup'@'localhost' IDENTIFIED BY 'CHANGE_ME_BACKUP_PASSWORD';
GRANT SELECT, SHOW VIEW, TRIGGER, LOCK TABLES, EVENT ON oriantal_perfumes.* TO 'oriantal_backup'@'localhost';
-- backup_runs bookkeeping is written by the backup script using the app account (INSERT/UPDATE already granted).
FLUSH PRIVILEGES;
