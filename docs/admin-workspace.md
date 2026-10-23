# Admin workspace and migration

## Supabase setup

Use a Supabase Cloud project; no local PostgreSQL installation is needed. In the Supabase dashboard open **SQL Editor → New query**. Run these in order:

1. `database/schema.sql`
2. `database/auth-schema.sql`
3. `database/admin-dashboard-schema.sql`

The admin migration is transactional and idempotent. It extends existing tables and creates deadlines, track topics, public conference people, FAQs, and site settings. It does not add demo rows. Set the PostgreSQL connection URI as `DATABASE_URL` in `server/.env`; it is read only by Express and must never be copied into `client/.env`.

## Access model

- Super Admin access is granted only through the protected initial-admin procedure. This dashboard does not provide a Super Admin role grant.
- A Conference Admin is scoped through `conference_memberships`, or is the `organizer_user_id` on a conference. Every conference mutation verifies that scope on the server.
- Conference Admin accounts can create new draft conferences when they already hold the scoped Conference Admin role. The creator is set as organizer and added to the new conference membership.
- Global user status, inquiries, site settings, and audit history are Super Admin-only.
- Public API queries only expose conferences in a public lifecycle status. Draft, unpublished, cancelled, and archived records stay private.

All database values are passed as parameters. Identifiers used as SQL table/column names are selected from server-side allowlists. Record mutations use transactions and write an audit row in the same transaction where applicable. Lifecycle changes use a compare-and-update predicate to reject concurrent stale changes.

## Dashboard routes

Open `/admin` or `/organizer` after signing in. The backend API is mounted under `/api/admin`:

- `GET/POST /conferences`, `PATCH /conferences/:id`, `POST /conferences/:id/lifecycle`, and `/conferences/:id/deadlines`
- `GET/POST/PATCH /tracks` and `/tracks/:trackId/topics`; `PATCH /topics/:id`
- `GET/POST/PATCH /people`, `/announcements`, and `/faqs`
- `GET/PATCH /users`, `GET/PATCH /inquiries`
- `GET /stats`, `GET /audit-logs`, and `GET/PUT /settings`

List endpoints support `q`, `page`, `limit`, and allowlisted `sort`/`order` values. Conference-scoped endpoints accept `conferenceId`. Every write requires an authenticated session plus CSRF validation. The dashboard intentionally uses real database counts; no placeholder figures are supplied.

The current lightweight record forms cover conference deadlines, tracks, conference people, announcements, and FAQ content. The schema includes track topics and site settings for continued UI development, and their protected APIs are present. Configure a production email provider separately for real outbound messages.

## Local checks

From a PowerShell terminal at the repository root:

```powershell
npm.cmd --prefix server test
npm.cmd --prefix client run build
```

The automated server suite uses `pg-mem` and is not a live Supabase connectivity check.
