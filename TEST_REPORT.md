# TEST_REPORT

نُفّذت بتاريخ 2026-10-23 على: Node v22, MySQL 8.0.46 (قاعدة اختبار منفصلة `oriantal_perfumes_test`)، عبر `npm test`.

**النتيجة الفعلية: 72 / 72 نجحت، 0 فشلت.** (شُغّلت الحزمة كاملة أكثر من مرة بعد إصلاح الأخطاء؛ الأخطاء التي ظهرت أثناء التطوير وتم إصلاحها مذكورة بالأسفل.)

## الاختبارات المنفذة
- ✔ login: correct credentials create a session with HttpOnly cookie
- ✔ login: wrong password / unknown account / disabled account all get the same 401
- ✔ login: account locks after repeated failures
- ✔ passwords are stored as bcrypt hashes
- ✔ admin API: no session -> 401, customer -> 403, staff -> 200
- ✔ least privilege: order_manager cannot manage users/products/stock; inventory_manager cannot review payments
- ✔ CSRF: state-changing request with a session but no token is rejected; wrong origin rejected
- ✔ logout revokes the session server-side
- ✔ expired session is rejected
- ✔ register: creates a customer; duplicate email -> 409; role cannot be injected
- ✔ role change revokes the user sessions and is audited
- ✔ backup runs, is encrypted (no plaintext SQL), checksummed and recorded as verified
- ✔ corrupted or truncated backups are detected
- ✔ wrong encryption key cannot read the backup
- ✔ restore into a SEPARATE database reproduces data and passes integrity checks
- ✔ restore refuses to overwrite the live database
- ✔ a failing backup is recorded as failed and leaves no new backup file (bad mysqldump)
- ✔ admin system status reports stale/missing backups honestly
- ✔ DB refuses negative stock, negative prices, bad coupon values
- ✔ foreign keys: cannot delete a product that has order history; cannot insert orphan items
- ✔ only ONE live shipping payment per order (generated unique key)
- ✔ stock ledger matches stock: sum of movements == current stock for every product
- ✔ money consistency: totals equal item sums on every order
- ✔ migrations are tracked and tamper-evident
- ✔ valid order: server computes totals; COD / InstaPay split is correct; stock deducted; movement + audit written
- ✔ client-supplied price / shipping / discount / status / userId are rejected (mass assignment)
- ✔ invalid products / quantities / zones / missing idempotency key
- ✔ coupons: invalid rejected; valid percent coupon applied server-side and counted once
- ✔ idempotency: same key + same request returns the SAME order and deducts stock once
- ✔ idempotency under true concurrency: 5 parallel identical requests -> exactly one order
- ✔ stock race: 8 simultaneous buyers for the last 5 units -> exactly 5 succeed, stock never negative
- ✔ last piece: two buyers each want the final unit -> one wins
- ✔ no partial orders: if the 2nd line is out of stock the whole order rolls back (1st product untouched)
- ✔ DB failure mid-transaction leaves no order and no stock change
- ✔ price snapshot: changing the product price later does not change old orders
- ✔ cancel returns stock exactly once; second cancel and status skips are refused
- ✔ unpaid orders expire automatically and return stock
- ✔ order tracking needs the right token; customers cannot read each other's orders
- ✔ quote endpoint matches order totals and never changes stock
- ✔ receipt upload moves the order to "under review" - it does NOT confirm payment
- ✔ upload validation: wrong token, fake image, oversized, missing proof, double submission
- ✔ only authorised reviewers can confirm: customer/guest/inventory_manager are refused
- ✔ confirm: amount must match shipping fee; success records reviewer + time; repeat is refused; audit written
- ✔ concurrent double-confirm: exactly one succeeds
- ✔ reject -> customer sees reason and can resubmit -> then confirm
- ✔ full lifecycle + COD: cannot ship before confirmation; COD must be recorded explicitly with the right amount
- ✔ receipt images are private: reviewers only, correct headers
- ✔ GET /products returns DB products (paginated, filtered, sorted)
- ✔ public product payload does not expose raw stock numbers
- ✔ GET missing / malformed product
- ✔ create product: allowed role OK, others rejected, bad data rejected
- ✔ mass assignment: stock/id/unknown fields cannot be set through product PATCH
- ✔ price update is saved, audited, and public API reflects it
- ✔ stock adjust: logged as movement, cannot go negative, requires a reason
- ✔ soft delete hides the product from the store but keeps the row
- ✔ SQL injection attempts are inert
- ✔ authorised staff receive order:created; guests and customers do not; payload is minimal
- ✔ NO event is emitted when the operation fails (out of stock / validation / DB error)
- ✔ product price change -> public product:updated (id only); stock sale -> staff inventory:updated
- ✔ order status + shipping payment events reach staff and ONLY the owning customer
- ✔ staff rooms cannot be joined by clients (no client-driven join)
- ✔ revoked/changed user is disconnected; reconnect works and REST gives the true state (resync)
- ✔ security headers (CSP, nosniff, frame-ancestors) and no X-Powered-By
- ✔ health endpoint is public, tiny and leaks nothing
- ✔ errors never leak stack traces / SQL / internals
- ✔ oversized JSON body is rejected (413) and wrong content-type (415)
- ✔ CORS: unknown origin refused, known origin allowed
- ✔ XSS: hostile product text is stored verbatim as data and returned as JSON (never as HTML); frontend escapes via esc()
- ✔ no secrets in frontend files, tracked examples, or audit/logs
- ✔ static server does not expose source, env or backups
- ✔ socket.io client library is served locally (CSP safe)
- ✔ rate limiting: repeated bad logins -> 429

## مشاكل حقيقية كشفتها الاختبارات وتم إصلاحها
- `db.query` كان يُفكَّك كمصفوفة في مسارات INSERT/UPDATE (500 عند إنشاء كوبون/مستخدم/حذف منتج).
- Socket.IO: دالة قراءة الـ cookie غير صحيحة لإصدار المكتبة (فشل مصادقة كل الاتصالات).
- التحقق من النسخة الاحتياطية كان يتسبب في خطأ غير ملتقط عند تلف الملف بدل أن يُرفض (تم استخدام `stream.pipeline`).
- اسم ملف النسخة الاحتياطية كان بدقة ثانية: نسخة فاشلة في نفس الثانية كانت تحذف نسخة سليمة سابقة (أصبح الاسم فريدًا + `wx`).
- ترتيب اختبار Rate limit كان يحجب اختبارات لاحقة (مشكلة في الاختبار نفسه).

## اختبارات إضافية يدوية/خارج الحزمة
- Smoke test للواجهة عبر jsdom على الخادم الحقيقي: تحميل 8 منتجات من MySQL → إضافة للسلة → اختيار محافظة وعرض ملخص من السيرفر → إنشاء طلب حقيقي → ظهور صندوق دفع InstaPay → تفريغ السلة؛ بدون أخطاء JS.
- نسخة احتياطية + استعادة في قاعدة منفصلة + فحوص السلامة (مغطاة أيضًا بـ backup.test.js).
- `npm audit`: 0 ثغرات معروفة وقت الفحص.
- تحميل `database/oriantal_perfumes_full.sql` في MySQL نظيف: 19 جدول بدون أخطاء.

## لم يُنفَّذ / غير مُختبر (يحتاج بيئة فعلية)
- اختبار الواجهة في **متصفح حقيقي** (Chrome/Safari/جوال) ولا اختبار E2E بـ Playwright (غير متاح هنا). jsdom لا يرسم CSS ولا يختبر الـ WebSocket بالواجهة.
- Socket.IO تم اختباره بعميل `socket.io-client` على WebSocket حقيقي، لكن **ليس** خلف Nginx/HTTPS.
- HTTPS، الدومين، Nginx، مؤقّت systemd، النسخ الخارجي (`BACKUP_OFFSITE_DIR`)، الأداء تحت حمل كبير (load test).
- MFA للأدمن، استعادة كلمة المرور بالبريد، استرداد (refund) آلي لتحويلات الشحن عند الإلغاء — **غير منفّذة** (الاسترداد يدوي).
- اختبار اختراق خارجي.

## مشاكل/مخاطر متبقية
- رسوم الشحن المرفقة **أرقام مثال** يجب أن يراجعها المالك. بيانات InstaPay فارغة حتى يُدخلها المالك.
- المنتجات التجريبية (8) من النموذج الأصلي وصورها من Unsplash (تحتاج إنترنت) — استبدلها بمنتجاتك.
- لو الطلب أُلغي بعد أن حوّل العميل الشحن فعليًا، الاسترداد يتم يدويًا خارج النظام.
- ملف `.env` المرفق للتطوير المحلي فقط ويحتوي كلمة سر MySQL التي أُرسلت في المحادثة — غيّرها.
