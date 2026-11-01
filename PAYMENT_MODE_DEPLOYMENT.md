Payment mode migration repair

Existing installations: back up database first, then run `cd backend` and `npm run migrate`.
The original 001_init_schema.sql is preserved. The new payment mode column is added by 006_payment_mode.sql.
Do not modify schema_migrations manually.
