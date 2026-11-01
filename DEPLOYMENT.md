# النشر (Ubuntu + Nginx + systemd)

1. **سيرفر**: Ubuntu 22.04+, Node 18+/20/22 (`nodesource`), MySQL 8, Nginx, certbot.
2. **MySQL**: شغّل `database/00_create_db_and_user.sql` كـ root بعد تغيير كلمات السر. لا تفتح بورت 3306 للخارج (اترك `bind-address=127.0.0.1`). لو DB على سيرفر آخر: شبكة خاصة + `DB_SSL=true`.
3. **الكود**: انسخ المشروع إلى `/opt/oriantal-perfumes` (المجلدان `backend/` و`frontend/` جنب بعض)، مستخدم نظام `oriantal`، ثم `cd backend && npm ci --omit=dev`.
4. **.env** (صلاحية 600) — انسخ من `.env.example`:
   `NODE_ENV=production`, `APP_ORIGINS=https://yourdomain.com`, `TRUST_PROXY=1`, `DB_USER=oriantal_app`, `DB_PASSWORD=…`, `DB_MIGRATION_USER=oriantal_migrator`, `BACKUP_ENCRYPTION_KEY=$(openssl rand -hex 32)`.
5. **الجداول**: `npm run migrate` (يستخدم حساب الـ migrator)، ثم `npm run create-admin`. **لا** تشغّل `seed` في الإنتاج الحقيقي (بيانات تجريبية) — أضف منتجاتك من لوحة الأدمن.
6. **الدومين/DNS**: سجل A لـ `@` و `www` على IP السيرفر. ثم `certbot --nginx -d yourdomain.com -d www.yourdomain.com` (HTTPS + تجديد تلقائي).
7. **Nginx**: `backend/deploy/nginx.conf` (يتضمن ترقية WebSocket لمسار `/socket.io/` وحد رفع 6MB).
8. **الخدمة**: `backend/deploy/oriantal-perfumes.service` → `systemctl enable --now oriantal-perfumes` (إعادة تشغيل تلقائية بعد الأعطال).
9. **النسخ الاحتياطي**: انظر BACKUP_RESTORE.md.
10. **المراقبة**: `GET /api/health` (يرجع 503 لو MySQL واقع) — اربطه بـ UptimeRobot/Healthchecks. اللوجات في `logs/` (تدوير يومي، 14 يوم، + `error-*.log` 30 يوم). لوحة الأدمن → System تعرض الذاكرة/القرص/آخر نسخة.
11. **التحديثات**: شهريًا `npm audit` و`npm outdated`، جرّب `npm test` على بيئة staging قبل النشر.
12. **عند عطل**: `journalctl -u oriantal-perfumes -n 100`، ثم `systemctl restart`. عند فقد بيانات: BACKUP_RESTORE.md.

ملاحظات: Instance واحد كافٍ للبداية (لا Redis). الواجهة تُخدَّم من Express نفسه. لم يتم نشر الموقع فعليًا ولم يُختبر الدومين/HTTPS هنا.
