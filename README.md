# BUP Conference Management System

Responsive public conference website and JavaScript foundation using React/Vite, Express, and Supabase Cloud PostgreSQL through `pg`. The app uses server-side authentication and authorization; there is no local PostgreSQL requirement.

## Requirements

- Node.js 20.19+ or 22.12+ and npm
- A Supabase Cloud project for live database use

## Windows setup (PowerShell in VS Code)

From the repository root:

```powershell
Copy-Item server\.env.example server\.env
Copy-Item client\.env.example client\.env
npm.cmd --prefix server install
npm.cmd --prefix client install
```

In Supabase **SQL Editor**, run `database/schema.sql`, then `database/auth-schema.sql`, `database/admin-dashboard-schema.sql`, `database/submission-workflow-schema.sql`, and `database/peer-review-schema.sql` (safe to re-run). In `server\.env`, set `DATABASE_URL` to the Supabase PostgreSQL connection URI (prefer the pooler URI for hosted deployments). Set a unique `CSRF_SECRET` (generate one with `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`), and set `CLIENT_ORIGIN` to the exact frontend origin. Do not put database, CSRF, SMTP, or storage secrets in `client\.env`.

For production, use HTTPS and set `NODE_ENV=production`; session cookies are then Secure. To require verified emails, set `AUTH_REQUIRE_EMAIL_VERIFICATION=true` and configure SMTP as described in [authentication.md](docs/authentication.md). If SMTP is absent, the API explicitly says email was not sent.

### Create the initial Super Admin

There is no public admin-registration endpoint. Once the schema and server environment are ready, create the first Super Admin interactively:

```powershell
npm.cmd --prefix server run auth:bootstrap-admin
```

The command prompts for credentials, masks the password, hashes it, and refuses to run after a Super Admin already exists. Details and role rules are in [authentication.md](docs/authentication.md).

### Start the services

In terminal 1:

```powershell
npm.cmd --prefix server run dev
```

In terminal 2:

```powershell
npm.cmd --prefix client run dev
```

Open the Vite URL (normally `http://localhost:5173`). The API is normally at `http://localhost:3000`. Set `DATABASE_URL` before relying on auth, contact messages, or public conference data.

### Test and build

```powershell
npm.cmd --prefix server test
npm.cmd --prefix client run build
```

The auth test suite uses an isolated in-memory PostgreSQL-compatible database, not your Supabase project. It does not claim live database connectivity.

## Public site and API

The public site provides Home, About, Conferences and Details, Important Dates, Tracks, Committee, Speakers, Schedule, Submission Guidelines, Registration Information, Contact, FAQ, Login, Register, Forgot/Reset Password, Privacy Policy, Terms, and Certificate Verification. Listings, dates, tracks, announcements, schedules, committee, speakers and certificate checks are backed by API queries. Empty states represent no published records; unavailable data shows an error instead of fake content.

Auth endpoints provide registration, login/logout, sessions, profile editing, password change/reset, email verification, role-based dashboards, scoped conference memberships, and submission ownership checks. Public registration only grants Participant/Attendee. The Super Admin and conference-specific access rules are enforced on the server.

## Admin workspace

After applying `database/admin-dashboard-schema.sql`, sign in as a Super Admin or conference-scoped Conference Admin and open `/admin` (also available at `/organizer`). The workspace supports conference draft creation/editing, lifecycle actions, typed deadlines, tracks, committee/speakers/organizers/session-chair entries, announcements, FAQs, users, inquiries, live database statistics, search, filters and pagination. All changes are validated and authorized by Express; conference actions are limited to the assigned conference. Super Admin-only areas include global users, inquiries, site settings, and audit history. The public listing hides draft, unpublished, and archived conferences.

In Supabase **SQL Editor → New query**, paste and run `database/admin-dashboard-schema.sql` after the core and auth schemas. This idempotent migration adds conference modes and organizer associations, lifecycle statuses, phase deadlines, track topics, public conference people, FAQs, and public settings. It creates no sample data. `/api/admin/settings` provides protected setting management; all mutations require the existing authenticated session and CSRF token.

## Author submissions

Authors can manage corresponding-author details and papers at `/author/submissions`. The form supports multiple authors, track and category selection, validated PDF uploads, a server-generated BUP paper code, revision and camera-ready versions, withdrawal requests, decisions, deadlines, and registration status. Private files are stored in a private Supabase Storage bucket, and the API issues a short-lived signed link only after checking author, reviewer, or conference-manager access. See [submission-workflow.md](docs/submission-workflow.md) for schema order, private bucket setup, and server environment variables.

Create a private bucket named `manuscripts` in Supabase Storage and configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET` in `server\.env`. Keep the service-role secret on the server. Local tests mock storage and use an in-memory database; they do not establish live Supabase connectivity.

## Peer review

Reviewers can update expertise and availability at `/reviewer`; conference organizers manage blind-review mode, criteria, assignments, deadlines, review summaries, conflicts, and editorial decisions at `/admin/reviews`. Reviewer permissions are scoped to their own assignment, while final decisions and confidential editor comments are limited to authorized organizers. Decisions create in-app notifications; email delivery uses the existing optional SMTP provider. See [peer-review.md](docs/peer-review.md) for assignment, conflict, double-blind, and decision behavior.

## Structure

```text
client/       React + Vite public site, account pages, and author workspace
server/       Express API, server-side auth, RBAC, submissions, and private uploads
database/     Core, auth, admin, and submission migrations for Supabase PostgreSQL
docs/         Supabase, authentication, admin, and submission setup
logo.png      Original BUP logo
hero.jpg      Original conference hero image (used at /hero.jpg)
```
