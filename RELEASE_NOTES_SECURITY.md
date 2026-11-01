# Oriantal Perfumes — changes and security notes

## Visual changes
- Cart quantity now overlays the shopping bag icon, replacing the separate dark circle.
- Added a lightweight responsive styling layer for spacing, product cards, mobile controls and keyboard focus.
- Existing API, orders, payment modes, database migrations and application logic were not changed.

## Security and deployment
- Removed the actual `backend/.env` from this **shareable distribution**. Copy `backend/.env.example` to `backend/.env` locally and populate your own credentials. Keep your original private `.env` outside this archive if you already have one.
- Removed local logs, uploaded files, backups and runtime files from the shareable distribution; these are not application source code.
- Added root `.gitignore` to avoid accidentally committing secrets and runtime data. Git ignore rules do not remove secrets from existing Git history.
- IMPORTANT: The original archive contained a Telegram bot token, database password and backup encryption key in `.env`. If it was shared, rotate those credentials. Do not paste them into public chat or commit them to Git.
- Do not publish `frontend/admin.html` as part of a static GitHub Pages preview. Public static pages cannot protect source files.
- No database schema modifications were needed for these changes. Do not rerun migrations until the migration-history checksum discrepancy is reconciled.
- Rate limiting uses an in-process store; for multiple server instances it would need a shared store. No new service or dependency was added.

## Verification
- Check bag counter at 0, 1, 9, 10+ items on mobile and desktop.
- Test product browsing, cart, checkout and admin against your existing private MySQL database after restoring local `.env`.
- GitHub Pages serves only the static storefront; backend endpoints require a separately hosted Node.js service.
