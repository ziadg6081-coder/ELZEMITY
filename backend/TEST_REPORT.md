# Test report — modified delivery

## Passed
- `node --check` passed for the modified JavaScript files: storefront app, admin UI, public routes, admin routes, catalog service, and order service.
- `npm run build:sql` completed and regenerated `backend/database/oriantal_perfumes_full.sql` from the migration files.

## Blocked / not verified
- The automated integration suite could not run because no MySQL server was listening at `127.0.0.1:3306` in the build environment (`ECONNREFUSED`). The existing suite depends on a real isolated MySQL test database. Its tests must not be described as passed.
- Browser-level responsive, Arabic/English, cart, checkout, admin, migration-on-existing-database, and WhatsApp/social-link behavior require a local run with MySQL and manual verification.

## Before production
1. Back up the current database.
2. Configure `backend/.env` from `.env.example` with valid credentials.
3. Run `npm run migrate` from `backend/`.
4. Run the integration suite against a dedicated test database.
5. Test products with at least three sizes, two sizes of the same product in one cart/order, tampered variant IDs, tampered client prices, and legacy products/orders.
6. Configure real WhatsApp/social URLs in Admin → Settings.
