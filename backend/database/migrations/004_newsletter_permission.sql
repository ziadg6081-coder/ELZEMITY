-- 004_newsletter_permission.sql : lets staff see, export and remove newsletter subscribers (Admin > Newsletter).
-- Granted to the admin role only. To give it to another role, insert a matching row into role_permissions.
INSERT INTO permissions (code, description) VALUES ('newsletter.manage','View, export and remove newsletter subscribers');
INSERT INTO role_permissions (role_id, permission_id) SELECT 2, id FROM permissions WHERE code = 'newsletter.manage';
