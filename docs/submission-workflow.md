# Author and manuscript workflow

The author workspace is available at `/author/submissions` (also linked from `/dashboard`). It supports corresponding-author details, a new submission form, multiple co-authors, track/category selection, revision history, withdrawal requests, decision status, registration status, permitted author-facing feedback, and manuscript downloads. `/submissions/new` opens the workspace at the submission form.

## Database setup

In the Supabase Dashboard, open **SQL Editor → New query**. Run the existing scripts in order:

1. `database/schema.sql`
2. `database/auth-schema.sql`
3. `database/admin-dashboard-schema.sql`
4. `database/submission-workflow-schema.sql`

The workflow migration is safe to re-run. It adds paper codes and categories, the clear workflow statuses, author profile details, and `submission_versions`. Each version references a random private object key, records file size and SHA-256, and is retained for history. Do not reset or replace the core schema on a project that already has data.

## Private Supabase Storage setup

In Supabase, open **Storage → New bucket** and create a bucket named `manuscripts`. Leave **Public bucket** disabled. The backend uses the service-role key only from the server, so no public bucket policy or browser storage key is needed. Do not put either storage key in `client/.env` or `VITE_*` variables.

Copy `server/.env.example` to `server/.env` and set these server-only values:

```dotenv
DATABASE_URL=postgresql://...your Supabase PostgreSQL connection URI...
SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...your Supabase service_role secret...
SUPABASE_STORAGE_BUCKET=manuscripts
MANUSCRIPT_MAX_BYTES=15728640
MANUSCRIPT_SIGNED_URL_SECONDS=300
```

Use the service-role credential from Supabase Project Settings/API Keys. Keep it secret and rotate it if exposed. Supabase Storage signed links are temporary bearer links; the API issues one only after confirming submission authorship, a reviewer assignment, or conference-management permission. The default expiry is five minutes and is capped at fifteen minutes. No public manuscript URLs or object keys are sent to the browser.

Set the paper submission and camera-ready dates for each conference in the Organizer workspace before accepting those submissions. If no `paper` deadline exists, the API falls back to the conference's legacy `submission_deadline`; no configured camera-ready deadline means camera-ready uploads remain closed.

## Workflow/security behavior

- Statuses are `draft`, `submitted`, `under_review`, `revision_required`, `accepted`, `rejected`, `camera_ready`, `finalized`, `withdrawal_requested`, and `withdrawn`. Initial uploads become `submitted`; revision uploads return a revision-required paper to `submitted`; an accepted paper's camera-ready upload sets `camera_ready`.
- Only conference managers can set review decisions. Authors can request withdrawal, but only a manager can approve it. Status transitions are checked on the backend.
- Submission and revision forms validate required fields and active conference tracks. Uploads are bounded, require PDF MIME type and `.pdf` filename, check the PDF header, document catalog/object structure and ending marker, and compute SHA-256. The default size limit is 15 MiB (configurable up to 50 MiB).
- Manuscript files and reviewer confidential comments are never included in author dashboard responses. Review feedback is selected only from `comments_to_authors` and only after a decision status.
- Co-authors with existing accounts are linked by their email address and receive access only to their shared submission. Unregistered co-authors remain listed with the paper but have no account session.
- All SQL values are parameterized. Protected mutations require the current authenticated session and CSRF token.

The file check is a structural sanity check, not antivirus scanning or complete PDF rendering. If your institution requires malware scanning, configure a scanning service before promotion to production.

## Local commands (Windows PowerShell)

From the repository root:

```powershell
Copy-Item server\.env.example server\.env
npm.cmd --prefix server install
npm.cmd --prefix client install
npm.cmd --prefix server test
npm.cmd --prefix client run build
npm.cmd --prefix server run dev
```

Start the frontend in a second terminal with `npm.cmd --prefix client run dev`. Live uploads require the Supabase database URI, Supabase project URL, service-role key, and a private `manuscripts` bucket. Tests use an isolated in-memory PostgreSQL-compatible database and mocked storage; they do not prove connectivity to your Supabase project.
