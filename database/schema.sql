-- BUP Conference Management System initial schema for Supabase Cloud PostgreSQL.
-- Run in the Supabase SQL Editor. UUID generation uses pgcrypto/gen_random_uuid().
begin;

create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  email text not null unique,
  full_name text not null,
  institution text,
  job_title text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id uuid not null references public.users(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  primary key(user_id, role_id)
);

create table if not exists public.conferences (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  acronym text,
  description text,
  venue text,
  timezone text not null default 'Asia/Dhaka',
  start_date date,
  end_date date,
  submission_deadline timestamptz,
  status text not null default 'draft' check (status in ('draft','published','submission_open','in_review','completed','cancelled')),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create table if not exists public.tracks (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  unique(conference_id, name)
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences(id) on delete cascade,
  track_id uuid references public.tracks(id) on delete set null,
  submitted_by uuid references public.users(id) on delete set null,
  title text not null,
  abstract text not null,
  keywords text[] not null default '{}',
  paper_url text,
  submission_type text not null default 'paper' check (submission_type in ('paper','poster','panel','workshop','other')),
  status text not null default 'submitted' check (status in ('draft','submitted','under_review','revision_requested','accepted','rejected','withdrawn')),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.authors (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  full_name text not null,
  email text not null,
  institution text,
  author_order smallint not null check (author_order > 0),
  is_corresponding boolean not null default false,
  created_at timestamptz not null default now(),
  unique(submission_id, author_order),
  unique(submission_id, email)
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  reviewer_id uuid not null references public.users(id) on delete restrict,
  status text not null default 'assigned' check (status in ('assigned','accepted','declined','in_progress','submitted')),
  recommendation text check (recommendation is null or recommendation in ('accept','minor_revision','major_revision','reject')),
  score numeric(4,2) check (score is null or (score >= 0 and score <= 100)),
  comments_to_authors text,
  confidential_comments text,
  assigned_at timestamptz not null default now(),
  due_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(submission_id, reviewer_id)
);

create table if not exists public.registrations (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete restrict,
  registration_type text not null default 'attendee' check (registration_type in ('attendee','author','student','speaker','organizer')),
  status text not null default 'pending' check (status in ('pending','confirmed','cancelled','refunded')),
  registered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(conference_id, user_id)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations(id) on delete restrict,
  amount numeric(12,2) not null check (amount >= 0),
  currency char(3) not null default 'BDT',
  provider text,
  provider_reference text unique,
  status text not null default 'pending' check (status in ('pending','succeeded','failed','refunded')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences(id) on delete cascade,
  track_id uuid references public.tracks(id) on delete set null,
  title text not null,
  description text,
  venue text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists public.session_submissions (
  session_id uuid not null references public.sessions(id) on delete cascade,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  primary key(session_id, submission_id)
);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  checked_out_at timestamptz,
  recorded_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(session_id, user_id),
  check (checked_out_at is null or checked_out_at >= checked_in_at)
);

create table if not exists public.certificates (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  registration_id uuid references public.registrations(id) on delete set null,
  certificate_type text not null check (certificate_type in ('attendee','author','presenter','reviewer','organizer')),
  certificate_number text not null unique,
  file_url text,
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(conference_id, user_id, certificate_type)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  conference_id uuid references public.conferences(id) on delete cascade,
  title text not null,
  body text not null,
  channel text not null default 'in_app' check (channel in ('in_app','email')),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.conference_dates (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences(id) on delete cascade,
  label text not null,
  description text,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at >= starts_at)
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid references public.conferences(id) on delete cascade,
  title text not null,
  body text not null,
  is_published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not is_published or published_at is not null)
);

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  subject text not null,
  message text not null,
  received_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new','in_progress','resolved'))
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);

create index if not exists idx_user_roles_role_id on public.user_roles(role_id);
create index if not exists idx_conferences_status_start on public.conferences(status, start_date);
create index if not exists idx_tracks_conference on public.tracks(conference_id);
create index if not exists idx_submissions_conference_status on public.submissions(conference_id, status);
create index if not exists idx_submissions_track on public.submissions(track_id);
create index if not exists idx_authors_user on public.authors(user_id);
create index if not exists idx_reviews_reviewer_status on public.reviews(reviewer_id, status);
create index if not exists idx_reviews_submission on public.reviews(submission_id);
create index if not exists idx_registrations_conference_status on public.registrations(conference_id, status);
create index if not exists idx_registrations_user on public.registrations(user_id);
create index if not exists idx_payments_registration_status on public.payments(registration_id, status);
create index if not exists idx_sessions_conference_start on public.sessions(conference_id, starts_at);
create index if not exists idx_attendance_user on public.attendance(user_id);
create index if not exists idx_certificates_user on public.certificates(user_id);
create index if not exists idx_notifications_user_unread on public.notifications(user_id, created_at desc) where read_at is null;
create index if not exists idx_audit_logs_entity on public.audit_logs(entity_type, entity_id, created_at desc);
create index if not exists idx_conference_dates_conference_start on public.conference_dates(conference_id, starts_at);
create index if not exists idx_announcements_published on public.announcements(published_at desc) where is_published = true;

insert into public.roles(name, description) values
  ('super_admin', 'Platform-wide administrator'),
  ('conference_admin', 'Conference administrator or organizer'),
  ('author', 'Research submission author'),
  ('reviewer', 'Peer reviewer'),
  ('attendee', 'Conference participant or attendee'),
  ('session_chair', 'Conference session chair')
on conflict (name) do nothing;

commit;
