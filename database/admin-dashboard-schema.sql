-- Idempotent additions for the conference administration workspace.
begin;

alter table public.conferences add column if not exists conference_mode text not null default 'in_person';
alter table public.conferences add column if not exists organizer_user_id uuid references public.users(id) on delete set null;
alter table public.conferences drop constraint if exists conferences_status_check;
alter table public.conferences add constraint conferences_status_check check (status in ('draft','unpublished','published','submission_open','in_review','completed','cancelled','archived'));
alter table public.conferences drop constraint if exists conferences_conference_mode_check;
alter table public.conferences add constraint conferences_conference_mode_check check (conference_mode in ('in_person','online','hybrid'));

create table if not exists public.conference_deadlines (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id) on delete cascade,
 deadline_type text not null check (deadline_type in ('abstract','paper','review','camera_ready','registration')),
 deadline_at timestamptz not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(conference_id, deadline_type)
);
create table if not exists public.track_topics (
 id uuid primary key default gen_random_uuid(), track_id uuid not null references public.tracks(id) on delete cascade,
 name text not null, description text, is_active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(track_id,name)
);
alter table public.tracks add column if not exists is_active boolean not null default true;
create table if not exists public.conference_people (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id) on delete cascade,
 user_id uuid references public.users(id) on delete set null,
 person_type text not null check (person_type in ('organizer','committee','keynote_speaker','session_chair')),
 full_name text not null, title text, institution text, bio text, email text, is_public boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.faqs (
 id uuid primary key default gen_random_uuid(), conference_id uuid references public.conferences(id) on delete cascade,
 question text not null, answer text not null, sort_order integer not null default 0, is_published boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.public_site_settings (
 key text primary key, value jsonb not null default '{}'::jsonb, updated_by uuid references public.users(id) on delete set null,
 updated_at timestamptz not null default now()
);
create index if not exists idx_conferences_organizer on public.conferences(organizer_user_id,status);
create index if not exists idx_deadlines_conference on public.conference_deadlines(conference_id,deadline_at);
create index if not exists idx_topics_track_active on public.track_topics(track_id,is_active);
create index if not exists idx_people_conference_type on public.conference_people(conference_id,person_type);
create index if not exists idx_faqs_public on public.faqs(is_published,sort_order);
commit;
