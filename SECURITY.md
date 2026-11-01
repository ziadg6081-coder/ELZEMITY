# الأمان

## المصادقة
- كلمات المرور: **bcrypt (cost 12)**. الحد الأدنى 8 للعملاء و10 للموظفين.
- جلسات سيرفر: توكن عشوائي 256-bit في Cookie `HttpOnly` + `SameSite=Lax` + `Secure` (إنتاج). يُخزَّن **هاش** التوكن في MySQL. جلسة جديدة عند كل دخول، صلاحية 12 ساعة، إبطال عند الخروج/تغيير الدور/تعطيل الحساب.
- **CSRF**: أي طلب تغييري بجلسة يحتاج `X-CSRF-Token` + فحص `Origin`.
- قفل الحساب 15 دقيقة بعد 5 محاولات فاشلة + Rate limit على تسجيل الدخول (10/15 دقيقة/IP). رسالة خطأ موحدة (لا كشف لوجود الحساب).
- **غير منفّذ**: MFA للأدمن، استعادة كلمة المرور بالبريد (لا يوجد بريد مُعدّ). تغيير كلمة سر موظف يتم من لوحة الأدمن.

## الصلاحيات (تُفحص على السيرفر دائمًا)
`products.manage` · `inventory.manage` · `orders.view` · `orders.manage` · `shipping_payments.review` · `users.manage` · `audit.view` · `settings.manage`
- admin: الكل. inventory_manager: منتجات + مخزون + عرض الطلبات. order_manager: عرض/إدارة الطلبات + مراجعة تحويلات الشحن.

## حماية الـ API
Helmet + CSP صارم (لا inline scripts) · CORS بقائمة بيضاء · Rate limits · حد 50KB للـ JSON · تحقق Zod `strict` (أي حقل غير معروف = رفض → لا Mass Assignment) · استعلامات Prepared فقط، و`ORDER BY` من Allowlist ثابتة · `multipleStatements=false` · رفع الملفات: فحص magic-bytes (JPEG/PNG/WebP)، حد 5MB، اسم عشوائي، **خارج** المجلد العام، ولا يُقرأ إلا بصلاحية مراجعة الدفع · أخطاء الإنتاج بلا Stack/SQL ومعها `requestId` · الـ Logs لا تحتوي query string أو body أو cookies.

## الأسعار والطلبات
السيرفر فقط يقرأ السعر/المخزون/الشحن/الخصم من MySQL داخل Transaction مع `SELECT … FOR UPDATE` + `UPDATE … WHERE stock >= ?` + قيد `CHECK`. مفتاح `Idempotency-Key` إلزامي لإنشاء الطلب.

## إعدادات الإنتاج المطلوبة
`NODE_ENV=production` (التطبيق **يرفض** العمل بـ root أو بدون DB_PASSWORD أو مع origins غير https) · HTTPS عبر Nginx · `TRUST_PROXY=1` · مستخدم MySQL محدود الصلاحيات · MySQL غير مفتوح للإنترنت · `BACKUP_ENCRYPTION_KEY` محفوظ خارج السيرفر.

## تسريب سابق
كلمة سر MySQL التي أُرسلت في المحادثة يجب **تغييرها** (`ALTER USER … IDENTIFIED BY …`) واعتبارها مكشوفة.

## الإبلاغ عن ثغرة
أرسل التفاصيل لصاحب المتجر مباشرة (لا تنشرها علنًا) وأرفق خطوات إعادة الإنتاج.

## حدود
لا يوجد ضمان أمان 100%. لم يُجرَ اختبار اختراق خارجي. ثبّت تحديثات الاعتماديات دوريًا (`npm audit`, `npm outdated`).
