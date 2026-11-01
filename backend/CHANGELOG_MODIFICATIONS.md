# Modification report — Oriantal Perfumes

## Implemented in this delivery
- Added database migration `005_product_variants_contact.sql`. It creates product size/price variants, backfills one variant for each existing non-deleted product, and adds an optional variant reference to order items while preserving historical size/price snapshots.
- Admin product form accepts multiple sizes and prices (one per line: `50 ml | 550`, optional previous price as a third field). The first variant remains mirrored into legacy product price/size columns for compatibility.
- Storefront product detail dialog allows selecting a size and immediately updates the displayed price. Cart lines and quote/order requests carry the selected variant ID; the server resolves prices from MySQL and validates that the variant belongs to the selected product.
- Replaced the customer-facing Our Story navigation/page with Contact. Contact links are loaded from public configuration.
- Added admin-managed WhatsApp number/enabled setting and configurable social account rows. Only HTTP/HTTPS URLs are accepted; unconfigured links are not shown.
- Added bilingual Contact label/intro and responsive contact/variant styles.
- Updated full SQL export and README/API docs.

## Important limitation
Inventory is still tracked at the product level and is shared across that product's size variants. Separate stock quantities per size were not requested and are not included.

## Security packaging
The distributable excludes the uploaded `.env`, runtime logs, and `node_modules`. Configure secrets locally using `backend/.env.example`. If the original `.env` contained a real database password or other credentials, rotate them before deployment.


## Added: Sales reports and inventory overview (2026-10-26)
- Added an authenticated `/api/admin/reports/summary?month=YYYY-MM` endpoint using persisted order, order-item, product, and inventory-movement records.
- Added the Admin **Reports & inventory** tab with current-vs-previous-month comparisons, collected shipping/COD money, delivered units/value, best-selling products, current stock valuation, low-stock and out-of-stock lists, and monthly stock movement totals.
- Added CSV export for the report.
- Existing stock adjustment and inventory movement workflows remain unchanged; the report reads from them and the existing database schema, so no new migration is required.
- Report definitions: money collected counts confirmed shipping fees and COD orders explicitly marked collected; units sold and product value use delivered orders only. Historical reports are based on order creation month.


## Sales dashboard redesign (2026-10-26)
- Replaced the previous combined report-and-inventory screen with a responsive, brand-matched sales overview; the existing Products & stock workflows remain available separately.
- Dashboard metrics, seven-day delivered-sales trend, category sales mix, latest products, and latest orders are queried from the existing MySQL database; no placeholder metrics or sample chart values are generated.
- Monthly sales are based on delivered orders and product totals (shipping excluded). Current-month comparisons use month-to-date against the same elapsed days of the previous month; historical months compare full calendar months. Comparison percentages are hidden when prior-period order/sales data is unavailable.
- CSV export now exports the sales dashboard summary. No database migration or change to startup commands is required.
- Static JavaScript syntax checks passed. Full MySQL-backed runtime verification was not available in the packaging environment.
