# ELZEMITY — متجر عطور إلكتروني
متجر كامل: **HTML/CSS/Vanilla JS** (واجهة) + **Node.js/Express** (API) + **MySQL** (قاعدة البيانات) + **Socket.IO** (تحديث لحظي).

## سياسة الدفع (ثابتة)
- العميل يدفع **مصاريف الشحن فقط** عبر **InstaPay** مقدّمًا، وصاحب المتجر **يراجعها ويؤكدها يدويًا**.
- ثمن العطور يُدفع **عند الاستلام (COD)**، ولا يُعتبر محصّلًا إلا بعد تسجيل التحصيل صراحةً.
- رفع صورة الإيصال **لا** يؤكد الدفع؛ التأكيد فقط من مستخدم مصرّح له.

## التشغيل محليًا (3 خطوات)
المتطلبات: Node.js 18+ و MySQL 8.0.16+ (يعمل على جهازك).

```bash
cd backend
npm install
npm run setup      # ينشئ قاعدة البيانات + الجداول + (اختياري) منتجات تجريبية + حساب الأدمن
npm start          # http://localhost:3000     لوحة الأدمن: http://localhost:3000/admin
```
أنشئ ملف `backend/.env` بنسخ `backend/.env.example` ثم أدخل إعدادات MySQL الخاصة بك. لا تشارك ملف `.env` ولا ترفعه إلى Git. استخدم مستخدم قاعدة بيانات مخصصًا في الإنتاج (انظر `database/00_create_db_and_user.sql`).

بعد التشغيل ادخل لوحة الأدمن → **Settings** وسجّل رقم/اسم **InstaPay** ورسوم الشحن لكل محافظة (القيم الموجودة **أمثلة** يجب مراجعتها). من نفس الإعدادات يمكن ضبط رقم WhatsApp وروابط السوشيال ميديا. من **Products** يمكن إدخال أحجام متعددة للمنتج؛ اكتب حجمًا وسعرًا بكل سطر بصيغة `50 ml | 550`، ويمكن إضافة السعر القديم اختياريًا مثل `50 ml | 550 | 650`. السعر والمخزون يُتحقق منهما على الخادم، والمخزون الحالي مشترك على مستوى المنتج وليس مستقلًا لكل حجم.

## بدون سطر أوامر؟
افتح `database/oriantal_perfumes_full.sql` في MySQL Workbench / phpMyAdmin ونفّذه — ينشئ كل الجداول (بما فيها جداول الأحجام الجديدة) والبيانات المرجعية. ثم أنشئ الأدمن بـ `npm run create-admin`.

## الأوامر
| أمر | وظيفته |
|---|---|
| `npm run setup` | إعداد كامل (DB + migrations + أدمن + منتجات تجريبية) |
| `npm run migrate` | تطبيق الـ migrations الجديدة فقط |
| `npm run create-admin` | إنشاء/ترقية أدمن (الباسورد يُكتب مخفيًا) |
| `npm run backup` | نسخة احتياطية مشفّرة + تحقق |
| `npm run restore -- <file> --target-db <name>` | استعادة في قاعدة منفصلة + فحوص سلامة |
| `npm test` | 72 اختبار على MySQL حقيقي (قاعدة `*_test` منفصلة) |
| `npm run build:sql` | إعادة توليد ملف SQL الكامل |

## الهيكل
```
frontend/            الواجهة: index.html, admin.html, css/, js/
backend/
  server/            Express API, Socket.IO, services, middleware
  database/          migrations/*.sql, oriantal_perfumes_full.sql, 00_create_db_and_user.sql
  scripts/           migrate, setup, seed, create-admin, backup, restore
  tests/             اختبارات node:test + supertest + socket.io-client
  deploy/            nginx, systemd
  .env.example  package.json
*.md                 الوثائق
```
عند تحديث نسخة قديمة، نفّذ `npm run migrate` من داخل `backend/` لتطبيق الترحيل الجديد للأحجام وبيانات التواصل، ثم أعد تشغيل السيرفر. لا تعدّل ملف ترحيل سبق تطبيقه.

كل الأوامر تُنفَّذ من داخل `backend/`. السيرفر يخدم مجلد `frontend/` تلقائيًا (نفس الدومين، وهذا مطلوب لعمل الـ Cookies والـ Socket.IO).
تغيير اسم المتجر: الاسم **ORIANTAL PERFUMES** موجود في `frontend/index.html` و `frontend/admin.html` وفي إعداد `store_name` بقاعدة البيانات وفي `backend/scripts/seed.js`.

## وثائق أخرى
`DATABASE.md` · `SECURITY.md` · `API.md` · `REALTIME.md` · `BACKUP_RESTORE.md` · `DEPLOYMENT.md` · `TEST_REPORT.md`


## Admin sales reports and inventory
Open `/admin` and sign in with a staff account that has `orders.view`, `inventory.manage`, or `products.manage`. Choose **Reports & inventory** to compare a selected month with the previous month, review collected shipping/COD money, delivered sales, best sellers, current stock value, low-stock items, and stock movements. Use **Export CSV** to save the report. Low-stock warnings use the `low_stock_threshold` setting. Reports read existing MySQL data and do not fabricate historical transactions; delivered-sales metrics only count delivered orders.
