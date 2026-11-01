# Socket.IO (إشعارات فقط — المصدر الحقيقي MySQL)

الاتصال يتحقق من Cookie الجلسة وقت الـ handshake. الضيف يدخل غرفة `public` فقط. **العميل لا يستطيع الانضمام لأي غرفة بنفسه** إلا غرفة طلبه عبر `order:subscribe` بـ tracking token.

| الحدث | من يستقبله | Payload (الحد الأدنى) |
|---|---|---|
| `order:created` | `staff:orders` (orders.view) | `{orderId, orderNumber, at}` |
| `order:statusChanged` | `staff:orders` + غرفة الطلب | `{orderId?, orderNumber, status, shippingPaymentStatus, at}` |
| `order:updated` (COD) | `staff:orders` + غرفة الطلب | `{orderId, orderNumber}` |
| `shippingPayment:submitted` | `staff:payments` (shipping_payments.review) | `{orderId, orderNumber}` |
| `shippingPayment:confirmed` / `:rejected` | `staff:payments` + غرفة الطلب | `{orderId, orderNumber}` |
| `inventory:updated` | `staff:inventory` (inventory/products.manage) | `{productId, quantity}` |
| `product:updated` | الجميع (`public`) | `{productId}` فقط |

القواعد: يُرسل الحدث **بعد COMMIT فقط** (لا حدث عند الفشل). لا بيانات عملاء/أسعار/أسرار في الأحداث؛ الواجهة تعيد الجلب من REST.
إعادة الاتصال: الواجهة تعرض شريط "Live updates paused"، وعند `connect` بعد انقطاع تعيد جلب المنتجات والطلب الحالي من API (Resync) — لا تفترض وصول أحداث فائتة. تعطيل مستخدم/تغيير دوره يقطع اتصالاته فورًا.
نسخة واحدة من التطبيق (Instance واحد) لا تحتاج Redis. عند التشغيل على أكثر من Instance أضف `@socket.io/redis-adapter` + sticky sessions.
