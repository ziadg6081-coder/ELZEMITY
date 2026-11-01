# قاعدة البيانات (MySQL 8.0.16+, InnoDB, utf8mb4)

## الجداول (19)
| الجدول | الغرض |
|---|---|
| `roles`, `permissions`, `role_permissions` | الصلاحيات: customer / admin / inventory_manager / order_manager |
| `users` | الحسابات (bcrypt)، قفل بعد محاولات فاشلة |
| `sessions` | جلسات (نخزّن SHA-256 للتوكن فقط) مع CSRF token وانتهاء وإبطال |
| `categories`, `products` | الكتالوج. `price DECIMAL(10,2)`، `CHECK(price>=0)`, `CHECK(stock_quantity>=0)`، حذف ناعم `deleted_at` |
| `inventory_movements` | سجل حركة المخزون (بيع/إلغاء/تعديل). مفتاح فريد يمنع خصم أو إرجاع نفس الطلب مرتين |
| `shipping_zones` | رسوم الشحن لكل محافظة (من السيرفر فقط) |
| `coupons` | خصومات (نسبة/مبلغ ثابت، حد أدنى، حد استخدام، انتهاء) |
| `orders` | الطلب + حالات (الطلب / دفع الشحن / COD) + مبالغ |
| `order_items` | **لقطة** الاسم والسعر والكمية وقت الطلب (لا تتغير بتعديل المنتج) |
| `shipping_payments` | محاولات دفع الشحن + الإيصال + من راجع ومتى. عمود مولّد `live_flag` + UNIQUE يضمن **دفعة حية واحدة فقط** لكل طلب |
| `settings` | InstaPay، مدة صلاحية الدفع، حد المخزون المنخفض، اسم المتجر |
| `audit_logs` | سجل العمليات الحساسة (بدون أسرار) |
| `idempotency_keys` | منع تكرار الطلبات |
| `backup_runs` | حالة كل نسخة احتياطية |
| `newsletter_subscribers` | اشتراكات النشرة |
| `schema_migrations` | إصدارات الـ migrations + checksum |

## المبالغ في `orders`
`subtotal − discount_total = products_total` (يُدفع COD) · `shipping_fee` (يُدفع InstaPay مقدّمًا) · `grand_total = products_total + shipping_fee`.
الحساب كله بالقروش (أعداد صحيحة) في `server/lib/money.js`؛ التقريب: نصف لأعلى لأقرب قرش (يؤثر على كوبونات النسبة فقط).

## حالات الطلب
`awaiting_shipping_payment → shipping_payment_under_review → confirmed → processing → shipped → delivered`
- الإلغاء مسموح قبل `shipped` (يرجّع المخزون مرة واحدة)؛ `returned` بعد `shipped/delivered` (لا يرجّع المخزون تلقائيًا — يراجع المالك القطعة ويعدّل المخزون يدويًا).
- `confirmed` لا يتحقق إلا عبر تأكيد تحويل الشحن (مراجعة مصرّحة). `processing/shipped` يتطلبان دفع شحن مؤكد.
- الطلب غير المدفوع شحنه يُلغى تلقائيًا بعد `shipping_payment_window_hours` (افتراضي 48 ساعة) ويُرجَع المخزون.

## الإعداد
```bash
npm run setup                     # كل شيء
# أو يدويًا
npm run migrate                   # ينشئ DB (لو مسموح) ويطبق backend/database/migrations/*.sql
mysql -u root -p < database/oriantal_perfumes_full.sql   # بديل: ملف واحد
```
لا تعدّل migration تم تطبيقه (يُرفض بسبب checksum) — أضف ملفًا جديدًا `004_*.sql`.

## التحقق من السلامة
اختبارات `tests/integrity.test.js` و `scripts/restore.js` تفحص: عدم وجود مخزون سالب، تطابق إجماليات الطلبات مع بنودها، تطابق سجل الحركة مع المخزون، عدم وجود بنود يتيمة، وعدم وجود طلب مؤكد بدون دفع شحن مؤكد.
