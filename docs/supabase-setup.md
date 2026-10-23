# Supabase Cloud setup

The API connects to Supabase-hosted PostgreSQL with the Node.js `pg` driver. A local PostgreSQL installation is not required. Keep every database and SMTP credential in `server/.env`; never put them in client environment variables.

1. Create a Supabase Cloud project and set a strong database password.
2. In the dashboard, open **SQL Editor → New query**. Paste and run `database/schema.sql` to create the core conference tables and role names.
3. In a second SQL Editor query, paste and run `database/auth-schema.sql` to add password/session/token columns and conference-specific memberships. For an existing project, run both scripts again; they use idempotent `if not exists`/conflict-safe statements.
4. Open **Project Settings → Database → Connection string**, choose URI, and copy the connection URI shown for the project. Prefer the direct connection when available; choose a Supabase session pooler when your network is IPv4-only. URL-encode special characters in the password.
5. In VS Code PowerShell, run `Copy-Item server\.env.example server\.env`, then set `DATABASE_URL` in `server\.env`. Leave the TLS verification setting enabled unless Supabase explicitly documents otherwise for your selected endpoint.
6. Generate a production CSRF secret with `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"` and set the result as `CSRF_SECRET` in `server/.env`. Do not reuse secrets. Set `NODE_ENV=production` behind HTTPS; the auth cookie then gets the `Secure` attribute. Set `CLIENT_ORIGIN` to the exact browser origin.
7. Start the API with `npm --prefix server run dev`. `/api/health` indicates whether a connection string is configured; it does not test database connectivity.

Do not place the database password, `service_role` key, `CSRF_SECRET`, or SMTP password in `client/.env` or a `VITE_` variable. This app performs database access through the server and does not use the Supabase Data API directly. If you separately enable that API, design and enable Row Level Security policies first.
