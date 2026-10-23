# Peer-review workflow

Apply `database/peer-review-schema.sql` in Supabase SQL Editor after the core, authentication, admin, and submission workflow migrations. It adds reviewer profiles, conference review mode and rubric criteria, review rounds and scoring data, COI declarations, and editorial decision history. The migration preserves existing review rows and their current statuses.

## Use the reviewer workspace

1. A Super Admin or organizer assigns the Reviewer role to an account in the conference Memberships section.
2. The reviewer signs in and opens `/reviewer` (or the Reviewer workspace link on `/dashboard`). They can update their expertise, biography, and availability.
3. Reviewers can accept or decline assignments, declare a conflict, read only their assigned paper versions through short-lived signed links, save drafts, and submit a recommendation with rubric scores and separate author/editor comments.
4. Pending, submitted, and overdue assignments are listed in the reviewer workspace.

The API only returns assignments for the signed-in reviewer. An author cannot be assigned to their own submission, whether their account is linked by user ID or email. A declared conflict changes the assignment to `conflict_declared` and blocks further review access. Organizers can see the reason and make a replacement assignment.

## Organizer workflow

Open `/admin/reviews` from the Management workspace. Select a conference to:

- Configure single-blind or double-blind mode and scoring criteria (one to twenty criteria, each scored from 1 to 10). Criteria lock when the first assignment exists so submitted scores remain interpretable.
- Assign an active reviewer who has a global or conference-scoped Reviewer role, set a round and optional future deadline, and notify the reviewer.
- Review rubric scores, recommendations, author-facing comments, confidential editor comments, overdue assignments, and conflicts.
- Record a separate final decision: Accept, Reject, or Revision Required. A score or recommendation never sets a final decision automatically.
- Re-review revised papers in a later round and retain each review and decision in history.

Only conference organizers assigned to the conference, or a Super Admin, can manage assignments, see confidential editor comments, or record decisions. Reviewer recommendations and final decisions are separate records. The API validates transitions and does not permit changing a final Accepted/Rejected paper back into an active review status. Revision Required papers return to Submitted when the author uploads a revision.

Decision and assignment notifications are persisted in `public.notifications`. If SMTP is configured through `SMTP_HOST`, `MAIL_FROM`, and the relevant mail settings in `server/.env`, the server also attempts email delivery. Without SMTP, it creates the in-app notification only and does not claim an email was sent.

## Blind review details

Double-blind mode omits author names, email addresses, affiliations, and submitter identity from reviewer API responses. The uploaded PDF itself is not automatically anonymized or scrubbed. For a double-blind conference, ask authors to remove names, affiliations, acknowledgements, identifying PDF metadata, and self-identifying citations before uploading; replace identifying file names with anonymous names. The reviewer interface receives the stored PDF unchanged.

Single-blind mode includes the author list in assignment details. In both modes, the server does not return other reviewers' drafts or confidential comments. Author-facing feedback is withheld until an organizer records a decision and is read only from `comments_to_authors`; `confidential_comments` and editor notes are never returned to authors.

## External setup and verification limits

No new external provider is required. Database operations use the configured `DATABASE_URL`; private paper access continues to require the Supabase project URL, server-only service-role key, and private `manuscripts` bucket described in [submission-workflow.md](submission-workflow.md). Optional review email uses the SMTP configuration documented in [authentication.md](authentication.md).

Local peer-review tests use the isolated in-memory database and mock signed Storage links. They verify role scoping, conflicts, scores, blind-mode identity redaction, comments, decisions, notification records, and invalid transitions. They do not test live Supabase connectivity or external SMTP delivery.
