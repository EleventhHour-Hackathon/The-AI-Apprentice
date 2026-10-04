-- A new hire working a case with the tutor, taught from one Work Map.
create table if not exists public.lessons (
  id uuid primary key,
  work_map_id uuid not null references public.work_maps (id) on delete cascade,
  conversation_id text,                       -- ElevenLabs conversation with the tutor
  started_at timestamptz not null default now(),
  status text not null default 'active',      -- active | finished
  attempts jsonb not null default '[]',       -- predictions, interventions, steps done right
  transcript jsonb not null default '[]',
  report jsonb                                -- mastered / practice next / not covered
);
create index if not exists lessons_work_map on public.lessons (work_map_id, started_at desc);

alter table public.lessons enable row level security;
