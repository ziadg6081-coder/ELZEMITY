/* Admin panel strings (English / Arabic).  Format:  "key": ["English", "العربية"]  (shared labels live in strings-store.js) */
(function () {
  "use strict";
  var S = {
    "a.title": ["Admin — Elzemity", "لوحة التحكم — الزميتي"],
    "a.sessionExpired": ["Session expired - please log in again", "انتهت الجلسة — سجّل الدخول مرة أخرى"],
    "a.login.title": ["Staff login", "دخول الموظفين"],
    "a.login.btn": ["Log in", "تسجيل الدخول"],
    "a.logout": ["Log out", "تسجيل الخروج"],
    "a.email": ["Email", "البريد الإلكتروني"],
    "a.password": ["Password", "كلمة المرور"],
    "a.noAccess": ["No access", "لا توجد صلاحية"],
    "a.noAccess.text": ["This account does not have staff permissions.", "هذا الحساب ليس لديه صلاحيات الموظفين."],
    "a.retry": ["Retry", "إعادة المحاولة"],
    "a.search": ["Search", "بحث"], "a.prev": ["‹ Prev", "السابق ›"], "a.next": ["Next ›", "‹ التالي"],
    "a.edit": ["Edit", "تعديل"], "a.delete": ["Delete", "حذف"], "a.save": ["Save", "حفظ"], "a.cancel": ["Cancel", "إلغاء"], "a.add": ["Add", "إضافة"],
    "a.yes": ["yes", "نعم"], "a.no": ["no", "لا"], "a.enable": ["Enable", "تفعيل"], "a.disable": ["Disable", "تعطيل"], "a.back": ["‹ Back to orders", "رجوع للطلبات ›"],

    "a.tab.orders": ["Orders", "الطلبات"], "a.tab.reports": ["Reports & inventory", "التقارير والجرد"], "a.tab.products": ["Products & stock", "المنتجات والمخزون"],
    "a.tab.newsletter": ["Newsletter", "المشتركون بالنشرة"], "a.tab.settings": ["Settings", "الإعدادات"],
    "a.tab.users": ["Staff & users", "الموظفون والمستخدمون"], "a.tab.audit": ["Audit log", "سجل العمليات"], "a.tab.system": ["System", "النظام"],

    "a.allStatuses": ["All statuses", "كل الحالات"], "a.orders.search": ["Order no., name or phone", "رقم الطلب أو الاسم أو الهاتف"],
    "a.o.order": ["Order", "الطلب"], "a.o.customer": ["Customer", "العميل"], "a.o.gov": ["Gov.", "المحافظة"], "a.o.status": ["Status", "الحالة"],
    "a.o.shipPay": ["Shipping payment", "دفع الشحن"], "a.o.cod": ["COD", "الدفع عند الاستلام"], "a.o.total": ["Total", "الإجمالي"], "a.o.created": ["Created", "تاريخ الإنشاء"],
    "a.o.none": ["No orders found.", "لا توجد طلبات."],

    "a.od.customer": ["Customer", "العميل"], "a.od.phone": ["Phone", "الهاتف"], "a.od.address": ["Address", "العنوان"],
    "a.od.products": ["Products", "المنتجات"], "a.od.discount": ["Discount", "الخصم"], "a.od.shipping": ["Shipping (InstaPay)", "الشحن (إنستاباي)"],
    "a.od.codAmount": ["COD amount", "مبلغ الدفع عند الاستلام"], "a.od.grand": ["Grand total", "الإجمالي الكلي"],
    "a.od.items": ["Items (price snapshot)", "المنتجات (الأسعار وقت الطلب)"], "a.od.subs": ["Shipping payment submissions", "بيانات تحويل الشحن المرسلة"],
    "a.od.claimed": ["Claimed", "المبلغ المذكور"], "a.od.ref": ["Reference", "المرجع"], "a.od.receipt": ["Receipt", "الإيصال"], "a.od.reviewed": ["Reviewed by", "راجعه"],
    "a.od.viewImg": ["View image", "عرض الصورة"], "a.od.nosubs": ["Nothing submitted yet.", "لم يتم إرسال شيء بعد."],
    "a.od.received": ["Amount actually received (EGP)", "المبلغ المستلم فعليًا (ج.م)"], "a.od.confirm": ["Confirm transfer", "تأكيد التحويل"],
    "a.od.rejReason": ["Rejection reason", "سبب الرفض"], "a.od.rejEx": ["e.g. amount not received", "مثال: لم يصل المبلغ"], "a.od.reject": ["Reject", "رفض"],
    "a.od.warn": ["A receipt image is NOT a confirmation. Check your InstaPay app first.", "صورة الإيصال ليست تأكيدًا للدفع. تحقق من تطبيق إنستاباي أولًا."],
    "a.od.actions": ["Order actions", "إجراءات الطلب"], "a.od.cancel": ["Cancel order (returns stock)", "إلغاء الطلب (يُرجع المخزون)"],
    "a.od.markAs": ["Mark {s}", "تحويل إلى: {s}"], "a.od.noMore": ["No further manual actions.", "لا توجد إجراءات يدوية أخرى."],
    "a.od.collected": ["COD collected ({amount})", "تم تحصيل المبلغ ({amount})"], "a.od.notCollected": ["Not collected", "لم يتم التحصيل"], "a.od.history": ["History", "السجل"],

    "a.p.new": ["+ New product", "+ منتج جديد"], "a.p.product": ["Product", "المنتج"], "a.p.category": ["Category", "القسم"], "a.p.price": ["Price", "السعر"],
    "a.p.stock": ["Stock", "المخزون"], "a.p.active": ["Active", "مُفعّل"], "a.p.adjust": ["Adjust stock", "تعديل المخزون"],
    "a.p.edit": ["Edit product", "تعديل المنتج"], "a.p.newTitle": ["New product", "منتج جديد"], "a.p.fName": ["Name *", "الاسم *"], "a.p.fCat": ["Category *", "القسم *"],
    "a.p.fBrand": ["Brand", "العلامة التجارية"], "a.p.fFamily": ["Scent family", "العائلة العطرية"], "a.p.fSize": ["Size (e.g. 50 ml)", "الحجم (مثال: 50 مل)"],
    "a.p.fPrice": ["Price (EGP) *", "السعر (ج.م) *"], "a.p.fOld": ["Old price (optional)", "السعر القديم (اختياري)"], "a.p.fTag": ["Tag", "الوسم"],
    "a.p.fStock": ["Initial stock", "المخزون المبدئي"], "a.p.fFile": ["Product image — upload from your device (JPG / PNG / WebP, max 5 MB)", "صورة المنتج — ارفعها من جهازك (JPG / PNG / WebP حتى 5 ميجابايت)"],
    "a.p.fLink": ["…or image link (https) — optional", "…أو رابط صورة (https) — اختياري"], "a.p.curImg": ["Current image:", "الصورة الحالية:"], "a.p.view": ["view", "عرض"],
    "a.p.fDesc": ["Description", "الوصف"], "a.p.visible": ["Visible in store", "ظاهر في المتجر"], "a.p.imgBig": ["Image is larger than 5 MB", "حجم الصورة أكبر من 5 ميجابايت"],
    "a.p.confirmDel": ["Delete this product? It disappears from the store; past orders keep their snapshot.", "حذف هذا المنتج؟ سيختفي من المتجر وتحتفظ الطلبات السابقة ببياناتها."],
    "a.p.stockPrompt": ["Adjust stock for \"{name}\".\nEnter a change like +10 or -2:", "تعديل مخزون \"{name}\".\nاكتب التغيير مثل +10 أو -2:"],
    "a.p.stockInt": ["Enter a whole number like +10 or -2", "اكتب رقمًا صحيحًا مثل +10 أو -2"], "a.p.stockReason": ["Reason (required):", "السبب (مطلوب):"], "a.p.stockNeedReason": ["A reason is required", "السبب مطلوب"],

    "a.n.title": ["Newsletter subscribers", "المشتركون في النشرة البريدية"], "a.n.search": ["Search email", "ابحث في الإيميلات"],
    "a.n.copy": ["Copy all emails", "نسخ كل الإيميلات"], "a.n.export": ["Export CSV", "تصدير CSV"],
    "a.n.hint": ["Tip: paste the copied emails into the BCC field of your email so subscribers can’t see each other’s addresses.", "نصيحة: الصق الإيميلات المنسوخة في خانة BCC (نسخة مخفية) حتى لا يرى المشتركون عناوين بعضهم."],
    "a.n.email": ["Email", "البريد الإلكتروني"], "a.n.date": ["Subscribed", "تاريخ الاشتراك"], "a.n.none": ["No subscribers yet.", "لا يوجد مشتركون بعد."],
    "a.n.copied": ["Copied {n} emails.", "تم نسخ {n} إيميل."], "a.n.confirmDel": ["Remove this subscriber?", "حذف هذا المشترك؟"], "a.n.deleted": ["Subscriber removed", "تم حذف المشترك"],

    "a.s.title": ["Store settings", "إعدادات المتجر"], "a.s.name": ["Store name", "اسم المتجر"], "a.s.handle": ["InstaPay handle / number (shown to customers after ordering)", "عنوان/رقم إنستاباي (يظهر للعملاء بعد الطلب)"],
    "a.s.account": ["InstaPay account name", "اسم حساب إنستاباي"], "a.s.window": ["Shipping payment window (hours)", "مهلة دفع الشحن (بالساعات)"], "a.s.low": ["Low-stock threshold", "حد تنبيه نفاد المخزون"], "a.s.save": ["Save settings", "حفظ الإعدادات"],
    "a.z.title": ["Shipping fees by governorate", "رسوم الشحن حسب المحافظة"], "a.z.gov": ["Governorate", "المحافظة"], "a.z.fee": ["Fee (EGP)", "الرسوم (ج.م)"],
    "a.c.title": ["Coupons", "كوبونات الخصم"], "a.c.code": ["Code", "الكود"], "a.c.percent": ["percent", "نسبة %"], "a.c.fixed": ["fixed (EGP)", "مبلغ ثابت (ج.م)"], "a.c.value": ["value", "القيمة"],
    "a.c.min": ["min subtotal", "الحد الأدنى للطلب"], "a.c.max": ["max uses", "أقصى استخدام"], "a.c.discount": ["Discount", "الخصم"], "a.c.minCol": ["Min", "الحد الأدنى"], "a.c.used": ["Used", "المستخدم"],

    "a.u.name": ["Name", "الاسم"], "a.u.pw": ["Password (min 10)", "كلمة المرور (10 أحرف على الأقل)"], "a.u.create": ["Create", "إنشاء"], "a.u.role": ["Role", "الدور"], "a.u.last": ["Last login", "آخر دخول"],
    "a.au.when": ["When", "الوقت"], "a.au.actor": ["Actor", "المنفّذ"], "a.au.action": ["Action", "الإجراء"], "a.au.entity": ["Entity", "العنصر"], "a.au.details": ["Details", "التفاصيل"], "a.au.system": ["system/customer", "النظام/العميل"],
    "a.sys.title": ["System status", "حالة النظام"], "a.sys.uptime": ["Uptime", "مدة التشغيل"], "a.sys.min": ["{n} min", "{n} دقيقة"], "a.sys.memory": ["Memory", "الذاكرة"], "a.sys.live": ["Live connections", "الاتصالات المباشرة"],
    "a.sys.disk": ["Disk free", "المساحة الفارغة"], "a.sys.backup": ["Last backup", "آخر نسخة احتياطية"], "a.sys.verified": ["· verified", "· تم التحقق"], "a.sys.notVerified": ["· NOT verified", "· لم يتم التحقق"],
    "a.sys.offsite": ["· off-site copy", "· نسخة خارجية"], "a.sys.noOffsite": ["· no off-site copy", "· لا توجد نسخة خارجية"], "a.sys.never": ["No backup has ever run", "لم يتم تشغيل أي نسخة احتياطية"],
    "a.sys.health": ["Backup health", "سلامة النسخ الاحتياطي"], "a.sys.stale": ["STALE: no verified backup in the last 36 hours", "متأخر: لا توجد نسخة موثّقة خلال آخر 36 ساعة"],

    "a.prompt.cancel": ["Reason for cancelling (optional)", "سبب الإلغاء (اختياري)"],
    "a.t.payConfirmed": ["Shipping payment confirmed", "تم تأكيد دفع الشحن"], "a.t.payRejected": ["Transfer rejected", "تم رفض التحويل"], "a.t.statusUpdated": ["Status updated", "تم تحديث الحالة"],
    "a.t.codRecorded": ["COD recorded", "تم تسجيل التحصيل"], "a.t.productSaved": ["Product saved", "تم حفظ المنتج"], "a.t.productDeleted": ["Product deleted", "تم حذف المنتج"],
    "a.t.stockNow": ["Stock is now {n}", "المخزون الآن {n}"], "a.t.saved": ["Saved", "تم الحفظ"], "a.t.zoneSaved": ["Zone saved", "تم حفظ المحافظة"], "a.t.couponAdded": ["Coupon added", "تمت إضافة الكوبون"],
    "a.t.userCreated": ["User created", "تم إنشاء المستخدم"], "a.t.roleUpdated": ["Role updated", "تم تحديث الدور"], "a.t.reconnected": ["Reconnected - data refreshed", "عاد الاتصال — تم تحديث البيانات"],
    "a.t.newOrder": ["New order {n}", "طلب جديد {n}"], "a.t.transfer": ["Shipping transfer submitted for {n} - needs review", "تم إرسال تحويل الشحن للطلب {n} — يحتاج مراجعة"], "a.t.newSub": ["New newsletter subscriber", "مشترك جديد في النشرة"],

    "role.admin": ["Admin", "مدير"], "role.order_manager": ["Order manager", "مسؤول الطلبات"], "role.inventory_manager": ["Inventory manager", "مسؤول المخزون"], "role.customer": ["Customer", "عميل"],
    "cod.pending": ["Pending", "قيد الانتظار"], "cod.collected": ["Collected", "تم التحصيل"], "cod.not_collected": ["Not collected", "لم يُحصَّل"],
    "bk.success": ["Success", "ناجحة"], "bk.failed": ["Failed", "فاشلة"], "bk.running": ["Running", "جارية"]
  };
  var out = {};
  Object.keys(S).forEach(function (k) { out[k] = { en: S[k][0], ar: S[k][1] }; });
  I18N.add(out);
})();
