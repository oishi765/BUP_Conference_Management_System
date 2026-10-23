-- Research submission workflow extension. Run after schema.sql, auth-schema.sql,
-- and admin-dashboard-schema.sql in the Supabase SQL Editor.
begin;

alter table public.submissions add column if not exists paper_code text;
alter table public.submissions add column if not exists category text not null default 'full_paper';
alter table public.submissions add column if not exists decision_note text;
alter table public.submissions add column if not exists withdrawal_requested_at timestamptz;
alter table public.submissions drop constraint if exists submissions_status_check;
update public.submissions set status = 'revision_required' where status = 'revision_requested';
alter table public.submissions add constraint submissions_status_check
  check (status in ('draft','submitted','under_review','revision_required','accepted','rejected','camera_ready','finalized','withdrawal_requested','withdrawn'));
alter table public.submissions drop constraint if exists submissions_category_check;
alter table public.submissions add constraint submissions_category_check
  check (category in ('full_paper','short_paper','poster','workshop','case_study','other'));
create unique index if not exists submissions_paper_code_unique on public.submissions(paper_code) where paper_code is not null;
create index if not exists submissions_owner_recent on public.submissions(submitted_by, created_at desc);

create table if not exists public.submission_versions (
 id uuid primary key default gen_random_uuid(),
 submission_id uuid not null references public.submissions(id) on delete cascade,
 version_number integer not null check(version_number > 0),
 version_type text not null check(version_type in ('initial','revision','camera_ready')),
 object_key text not null unique,
 original_filename text not null,
 file_size bigint not null check(file_size > 0),
 sha256 char(64) not null,
 uploaded_by uuid not null references public.users(id) on delete restrict,
 created_at timestamptz not null default now(),
 unique(submission_id, version_number)
);
create index if not exists submission_versions_history on public.submission_versions(submission_id, version_number desc);

create table if not exists public.author_profiles (
 user_id uuid primary key references public.users(id) on delete cascade,
 corresponding_name text,
 corresponding_email text,
 corresponding_affiliation text,
 updated_at timestamptz not null default now(),
 check(corresponding_email is null or length(corresponding_email) <= 254)
);

-- Normalize author emails for lookups while preserving the supplied display value.
create index if not exists authors_email_lookup on public.authors(lower(email));
commit;
