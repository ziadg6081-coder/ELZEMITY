# النسخ الاحتياطي والاستعادة

## كيف يعمل `npm run backup`
`mysqldump --single-transaction` → gzip → **AES-256-GCM** (المفتاح `BACKUP_ENCRYPTION_KEY`) → ملف `backups/<db>-<time>.sql.gz.enc` + `.sha256`.
بعدها **يتحقق فعليًا** (فك التشفير + فك الضغط + وجود الجداول وعلامة اكتمال الـ dump)، ويسجل في `backup_runs`، وينسخ لـ `BACKUP_OFFSITE_DIR` ويتحقق منه (إن ضُبط). أي فشل ⇒ exit code ≠ 0 ويُحذف الملف الناقص. يحذف أقدم النسخ المحلية بعد `BACKUP_KEEP` **فقط بعد نجاح نسخة جديدة موثقة**. باسورد DB يُمرَّر بمتغير بيئة (لا يظهر في قائمة العمليات).
لوحة الأدمن → System تعرض آخر نسخة وتحذّر إذا لا توجد نسخة موثقة خلال 36 ساعة.

## الجدولة (لازم تفعّلها على السيرفر — لا تعمل تلقائيًا من تلقاء نفسها)
`backend/deploy/oriantal-backup.service` + `.timer` (يوميًا 03:30):
```bash
sudo cp backend/deploy/oriantal-backup.* /etc/systemd/system/ && sudo systemctl enable --now oriantal-backup.timer
systemctl list-timers | grep oriantal
```
**خارج السيرفر**: اضبط `BACKUP_OFFSITE_DIR` على مسار مركّب من تخزين خارجي (أو أضف `rclone copy backups remote:oriantal` بعد النسخ). احفظ نسخة من `BACKUP_ENCRYPTION_KEY` في مكان آمن **منفصل** — بدونه لا يمكن فك أي نسخة.

## RPO / RTO مقترحان
- RPO: 24 ساعة بالنسخة اليومية (قلّل بزيادة التكرار: `OnCalendar=hourly` أو فعّل Binary Logs لـ Point-in-Time Recovery عند نمو الطلبات).
- RTO: ~30 دقيقة (تثبيت + استعادة + تشغيل).

## الاستعادة
```bash
# 1) تحقق + استعادة في قاعدة منفصلة + فحوص سلامة
node scripts/restore.js backups/oriantal_perfumes-XXXX.sql.gz.enc --target-db oriantal_restore_check
# 2) راجع الأعداد ونتيجة الفحوص (طلبات يتيمة، مخزون سالب، تطابق الإجماليات…)
# 3) عند الكارثة الفعلية: أوقف التطبيق ثم
node scripts/restore.js <file> --target-db oriantal_perfumes --overwrite-production   # يحتاج علمًا صريحًا
```
السكريبت يرفض الكتابة فوق قاعدة التشغيل بدون `--overwrite-production`.

## آخر اختبار فعلي (في بيئة التطوير هنا)
نسخة → تحقق → استعادة في قاعدة منفصلة → فحوص السلامة نجحت (19 جدول، جميع العلاقات، أعداد الصفوف مطابقة)، وكشف التلف/القطع/المفتاح الخطأ نجح (انظر TEST_REPORT.md). **لم** يُختبر النسخ الخارجي ولا مؤقّت systemd (يحتاجان سيرفرك).
