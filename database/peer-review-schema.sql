-- Peer-review, conflict, and editorial-decision migration.
-- Apply after schema.sql, auth-schema.sql, admin-dashboard-schema.sql,
-- submission-workflow-schema.sql.
begin;

alter table public.conferences add column if not exists review_mode text not null default 'single_blind';
alter table public.conferences drop constraint if exists conferences_review_mode_check;
alter table public.conferences add constraint conferences_review_mode_check check(review_mode in ('single_blind','double_blind'));

create table if not exists public.reviewer_profiles(
 user_id uuid primary key references public.users(id) on delete cascade,
 expertise text[] not null default '{}',
 availability text not null default 'available' check(availability in ('available','unavailable')),
 biography text,
 updated_at timestamptz not null default now()
);

alter table public.reviews add column if not exists review_round integer not null default 1;
alter table public.reviews add column if not exists criterion_scores jsonb not null default '{}'::jsonb;
alter table public.reviews add column if not exists overall_recommendation text;
alter table public.reviews drop constraint if exists reviews_status_check;
alter table public.reviews add constraint reviews_status_check check(status in ('assigned','accepted','declined','in_progress','submitted','conflict_declared','cancelled'));
alter table public.reviews drop constraint if exists reviews_score_check;
alter table public.reviews add constraint reviews_score_check check(score is null or (score >= 0 and score <= 100));
alter table public.reviews drop constraint if exists reviews_recommendation_check;
alter table public.reviews add constraint reviews_recommendation_check check(recommendation is null or recommendation in ('accept','minor_revision','major_revision','reject'));
alter table public.reviews drop constraint if exists reviews_submission_id_reviewer_id_key;
alter table public.reviews drop constraint if exists reviews_round_positive;
alter table public.reviews add constraint reviews_round_positive check(review_round > 0);
alter table public.reviews drop constraint if exists reviews_scores_object;
alter table public.reviews add constraint reviews_scores_object check(jsonb_typeof(criterion_scores)='object');
alter table public.reviews drop constraint if exists reviews_overall_recommendation_check;
alter table public.reviews add constraint reviews_overall_recommendation_check check(overall_recommendation is null or overall_recommendation in ('accept','minor_revision','major_revision','reject'));
create unique index if not exists reviews_submission_reviewer_round_unique on public.reviews(submission_id,reviewer_id,review_round);
create index if not exists reviews_deadline_state on public.reviews(reviewer_id,status,due_at);
create index if not exists reviews_submission_round on public.reviews(submission_id,review_round,status);

create table if not exists public.conference_review_criteria(
 id uuid primary key default gen_random_uuid(),
 conference_id uuid not null references public.conferences(id) on delete cascade,
 criterion_key text not null check(criterion_key ~ '^[a-z][a-z0-9_]{1,39}$'),
 label text not null check(length(label) between 2 and 120),
 max_score smallint not null default 5 check(max_score between 2 and 10),
 sort_order smallint not null default 0,
 is_active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(conference_id,criterion_key),
 unique(conference_id,sort_order)
);

create table if not exists public.review_conflicts(
 review_id uuid primary key references public.reviews(id) on delete cascade,
 declared_by uuid not null references public.users(id) on delete restrict,
 reason text not null check(length(reason) between 10 and 3000),
 created_at timestamptz not null default now(),
 resolved_at timestamptz,
 resolved_by uuid references public.users(id) on delete set null,
 resolution text
);

create table if not exists public.submission_decisions(
 id uuid primary key default gen_random_uuid(),
 submission_id uuid not null references public.submissions(id) on delete cascade,
 review_round integer not null check(review_round > 0),
 status text not null check(status in ('revision_required','accepted','rejected')),
 author_note text,
 editor_note text,
 decided_by uuid not null references public.users(id) on delete restrict,
 created_at timestamptz not null default now()
);
create index if not exists decisions_submission_history on public.submission_decisions(submission_id,created_at desc);

-- Existing conference entries receive the standard five criteria. New conferences
-- get these defaults when their organizer opens review setup.
insert into public.conference_review_criteria(conference_id,criterion_key,label,max_score,sort_order)
select c.id,v.key,v.label,5,v.position from public.conferences c
cross join (values ('originality','Originality',1),('technical_quality','Technical quality',2),('methodology','Methodology',3),('clarity','Clarity',4),('relevance','Relevance',5)) as v(key,label,position)
on conflict(conference_id,criterion_key) do nothing;

commit;
