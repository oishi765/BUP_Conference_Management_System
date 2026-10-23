-- Apply after database/schema.sql in the Supabase SQL Editor.
-- Idempotent authentication/RBAC migration; does not create an administrator.
begin;

alter table public.users add column if not exists password_hash text;
alter table public.users add column if not exists email_verified_at timestamptz;
alter table public.users add column if not exists profile_updated_at timestamptz;

insert into public.roles(name, description) values
  ('super_admin', 'Platform-wide administrator; granted only by the protected bootstrap CLI or an existing Super Admin'),
  ('conference_admin', 'Administrator for an explicitly assigned conference'),
  ('author', 'Research submission author'),
  ('reviewer', 'Peer reviewer assigned to conferences and submissions'),
  ('attendee', 'Conference participant or attendee'),
  ('session_chair', 'Chair assigned to a conference')
on conflict (name) do update set description = excluded.description;

create table if not exists public.conference_memberships (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete restrict,
  assigned_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(conference_id, user_id, role_id)
);

create table if not exists public.auth_sessions (
  token_hash char(64) primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  csrf_token char(64) not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  user_agent text,
  ip_address inet
);

create table if not exists public.password_reset_tokens (
  token_hash char(64) primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.email_verification_tokens (
  token_hash char(64) primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_conference_memberships_user on public.conference_memberships(user_id, conference_id);
create index if not exists idx_conference_memberships_role on public.conference_memberships(conference_id, role_id);
create index if not exists idx_auth_sessions_user_expiry on public.auth_sessions(user_id, expires_at);
create index if not exists idx_password_reset_user_expiry on public.password_reset_tokens(user_id, expires_at);
create index if not exists idx_email_verification_user_expiry on public.email_verification_tokens(user_id, expires_at);

commit;
