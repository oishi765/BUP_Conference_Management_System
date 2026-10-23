# Authentication, roles, and email

## Roles and authorization

The role names are `super_admin`, `conference_admin`, `author`, `reviewer`, `attendee`, and `session_chair` (shown to users as Super Admin, Conference Admin/Organizer, Author, Reviewer, Participant/Attendee, and Session Chair). Public registration always assigns only `attendee`; the request schema rejects extra fields such as a requested role.

Conference Admin, Reviewer, and Session Chair permissions are stored in `conference_memberships` and checked against the requested conference on the server. A Conference Admin can manage memberships only for conferences to which they were assigned. Reviewers can read only submissions explicitly assigned to them. Authors can read their own submissions and edit only their own drafts. Session Chairs can read submissions in their assigned sessions. A Super Admin can manage platform-wide accounts; no ordinary API can assign the `super_admin` role.

The Super Admin account can view user records, assign global Author/Attendee roles, and manage conference-scoped memberships. The browser dashboard and protected routes are convenience controls. API handlers independently check sessions, roles, conference membership, and record ownership on every protected request.

## First Super Admin

There is no public administrator signup. After both SQL files have run and `DATABASE_URL` is configured, open a private VS Code terminal at the project root and run:

```powershell
npm --prefix server run auth:bootstrap-admin
```

The interactive command asks for an email, name, and password without echoing the password, hashes it with scrypt, marks the operator-provided email verified, and records an audit event. A database advisory lock makes the first-account check safe against concurrent runs. It refuses to create another Super Admin after one exists. Never use a shared or universal password. Keep control of this account and grant conference roles only to named, authorized people.

Existing user rows from before the auth migration have no password hash. They can use the normal password-reset email flow after SMTP is configured; if verification is required, they can also request a verification email. Old role names such as `admin` and `organizer` do not grant the new Super Admin or Conference Admin permissions.

## Sessions and passwords

Passwords are stored as salted scrypt hashes. Session cookies contain random opaque tokens; only SHA-256 token hashes are stored in PostgreSQL. The cookie is HttpOnly, SameSite=Lax, scoped to `/api`, and Secure in production. State-changing auth and protected API requests require a signed/double-submit or session-bound CSRF token and validate a supplied Origin. Login and account-email endpoints are rate limited by client IP (10 sign-in attempts per 15 minutes; 8 account requests per hour). The built-in limiter uses process memory; a multi-instance deployment must configure a shared rate-limit store before scaling the API.

Password reset tokens are hashed in the database, expire after 30 minutes by default (configurable from 5 to 120 minutes), and are consumed once. A successful reset invalidates all sessions. Password changes verify the current password and rotate the active session. Reset links are sent only when an SMTP provider is configured and accepts the message.

## Email verification and SMTP

Set `AUTH_REQUIRE_EMAIL_VERIFICATION=true` to require email verification before login. In this mode, registration fails before creating an account if the email provider is not configured. Verification links expire after 24 hours and are single use. With the setting false, new accounts are marked verified without sending a message.

Configure the following only in `server/.env`:

```dotenv
SMTP_HOST=smtp.example.org
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-provider-username
SMTP_PASSWORD=your-provider-password
MAIL_FROM=BUP Conference Management <no-reply@example.org>
```

For implicit TLS (commonly port 465), set `SMTP_SECURE=true`; follow the chosen provider's connection settings. If any required provider settings are missing, reset and verification requests return an explicit “no email was sent” configuration error. If the provider rejects a message, the API logs a delivery failure without logging the token or claiming delivery. The app does not include an email provider account.

## Run the auth checks

```powershell
npm --prefix server test
npm --prefix client run build
```

The auth suite uses an isolated in-memory PostgreSQL-compatible test database; it exercises the HTTP handlers without Supabase credentials. It is not a live Supabase connectivity test. Test fixtures and passwords exist only in the test process.
