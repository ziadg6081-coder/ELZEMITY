# API (JSON). كل الأخطاء: `{ "error": { "code", "message", "requestId", "details?" } }`

المصادقة: Cookie `op_session` (HttpOnly). الطلبات التغييرية بجلسة تحتاج `X-CSRF-Token` (يرجع من `/auth/login` و `/auth/me`).

## عام
| Method | Path | وصف |
|---|---|---|
| GET | `/api/health` | `200 {status:"ok",db:"up"}` أو `503` |
| GET | `/api/config` | اسم المتجر، التصنيفات، رسوم الشحن |
| GET | `/api/products?category=&q=&sort=featured\|low\|high\|name&page=&limit≤60` | المنتجات النشطة |
| GET | `/api/products/:id` | منتج |
| POST | `/api/quote` | `{items:[{productId,quantity}], governorate?, couponCode?}` → حساب السيرفر |
| POST | `/api/orders` | **Header `Idempotency-Key` إلزامي**. Body: `name, phone, email?, governorate, city, address, couponCode?, items[]` (حقول السعر/الشحن مرفوضة). `201` + `order` (+`trackingToken`). التكرار بنفس المفتاح → نفس الطلب + `Idempotent-Replay: true` |
| GET | `/api/orders/:orderNumber` | Header `X-Order-Token` (أو مستخدم مسجل صاحب الطلب) |
| POST | `/api/orders/:orderNumber/shipping-payment` | multipart: `receipt` (صورة) و/أو `reference`. يحوّل الطلب إلى *قيد المراجعة* فقط |
| POST | `/api/newsletter` | `{email}` |

## حساب
`POST /api/auth/register` · `POST /api/auth/login` · `GET /api/auth/me` · `POST /api/auth/logout` · `POST /api/auth/logout-all` · `GET /api/me/orders`

## إدارة (`/api/admin/*` — موظفون فقط، صلاحية لكل مسار)
| Path | صلاحية |
|---|---|
| `GET /orders?status=&paymentStatus=&q=&page=` · `GET /orders/:id` | orders.view |
| `POST /orders/:id/status {status, reason?}` · `POST /orders/:id/cod {collected, amount?}` | orders.manage |
| `POST /orders/:id/shipping-payment/confirm {amount}` · `/reject {reason}` · `GET /shipping-payments/:id/receipt` | shipping_payments.review |
| `GET/POST /products` · `PATCH/DELETE /products/:id` · `POST /products/:id/image` (multipart `image`, JPG/PNG/WebP ≤5MB → `/media/products/…`) | products.manage |
| `POST /products/:id/stock {mode:"delta"\|"set", quantity, note}` · `GET /inventory/movements` | inventory.manage |
| `GET/PUT /settings` · `GET /shipping-zones` · `PATCH /shipping-zones/:id` · `GET/POST /coupons` · `PATCH /coupons/:id` · `GET /system` | settings.manage |
| `GET/POST /users` · `PATCH /users/:id` · `POST /users/:id/password` | users.manage |
| `GET /newsletter?q=&page=` · `GET /newsletter/emails` · `GET /newsletter/export` (CSV) · `DELETE /newsletter/:id` | newsletter.manage (migration 004، للأدمن فقط) |
| `GET /audit` | audit.view |

رموز الحالة: 400 تحقق · 401 غير مسجل · 403 صلاحية/CSRF · 404 · 409 تعارض (مخزون/حالة) · 413/415 · 422 قاعدة عمل (مبلغ لا يطابق، كوبون…) · 429 Rate limit · 503 DB.


## Product size variants and contact settings (added)
- Public product responses include `variants: [{ id, size, price, compareAtPrice, isActive }]`.
- Admin product create/update accepts `variants: [{ size, price, compareAtPrice? }]`; the legacy `price` and `sizeLabel` fields remain for backward compatibility and mirror the first variant.
- Quote/order item entries may include `variantId`. The server validates that the variant belongs to the selected product and calculates the price from MySQL; client-supplied prices are never accepted. Order items snapshot the selected size and unit price.
- Admin `PUT /api/admin/settings` accepts `contact_whatsapp`, `contact_whatsapp_enabled`, and `social_accounts` (array of `{ platform, url, enabled }`). Public `GET /api/config` returns the enabled contact and social account links.
- Migration `005_product_variants_contact.sql` backfills one variant from each existing product's current size and price. Inventory remains shared per product in this release; size-specific stock is not implemented.
