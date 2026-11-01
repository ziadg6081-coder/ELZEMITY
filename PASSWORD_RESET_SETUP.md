# Password reset setup / إعداد استعادة كلمة المرور

## Before starting
1. Back up the MySQL database.
2. Run **only** `backend/database/07_password_reset_manual.sql` once against the configured database. Do not run `npm run migrate` or `npm run setup`: the historical migration checksums in this project may differ from the live database.
3. Inside `backend`, run `npm install nodemailer@^7` to install the one new SMTP dependency and update `package-lock.json` (registry access is required). Then `npm start`.
4. Copy the SMTP variables from `backend/.env.example` to your private `backend/.env`. Set `PUBLIC_SITE_ORIGIN` to the origin hosting both the backend and the reset page.

## Example: Gmail with App Password
- SMTP_HOST=smtp.gmail.com
- SMTP_PORT=465
- SMTP_SECURE=true
- SMTP_USER=your-address@gmail.com
- SMTP_PASSWORD=your-google-app-password
- SMTP_FROM="Oriantal Perfumes <your-address@gmail.com>"
- PUBLIC_SITE_ORIGIN=https://your-actual-backend-site.example

Do not use your normal Gmail password. Google App Passwords require account eligibility and 2-step verification. SMTP credentials are secrets: never commit `.env` or put them in frontend files. SMTP requires a provider account and may have sending limits or charges.

## Behavior and security
- POST `/api/auth/forgot-password` with `{"email":"..."}` returns a generic success for both existing and missing accounts.
- POST `/api/auth/reset-password` with `{"token":"64-character-hex","password":"..."}` accepts one unexpired token, hashes the new password and revokes all sessions.
- Reset links expire in 15 minutes; only a SHA-256 hash of the token is stored.
- IP-based rate limits: 5 requests/hour for email request, 10 requests/15 minutes for confirmation. In-memory counters do not coordinate across multiple server processes.
- GitHub Pages **alone** cannot execute these endpoints. If your frontend is on GitHub Pages, configure an accessible HTTPS backend and adapt API routing and CORS/session architecture before enabling the feature. Do not send reset links to GitHub Pages unless the reset page can reach the actual API.
- The feature does not require changing existing user rows; it creates a separate table.

## Quick check
- With SMTP configured, use an existing test customer email and confirm the message arrives.
- Follow the link and set a new password; verify old sessions and old password no longer work.
- Confirm that an unknown email gets the same public success response.
