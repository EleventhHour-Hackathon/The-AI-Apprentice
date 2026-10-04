-- A Work Map row now exists from the moment a session starts, so screen events and
-- live captures have somewhere to go before the map itself is merged.
alter table public.work_maps
  add column if not exists status text not null default 'recording',  -- recording | draft | confirmed
  add column if not exists conversation_id text,                       -- ElevenLabs conversation
  add column if not exists captures jsonb not null default '[]',       -- what the agent recorded live
  add column if not exists duration real;                              -- seconds of work

-- Existing maps were finished sessions.
update public.work_maps set status = case when confirmed then 'confirmed' else 'draft' end
  where status = 'recording';

-- What changed on screen, when, and a small still of it: the "screen moment" a step links to.
create table if not exists public.screen_events (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.work_maps (id) on delete cascade,
  t real not null,            -- seconds since the session started
  event text not null,
  description text,
  kind text,                  -- action | navigation
  thumb text,                 -- data:image/jpeg;base64,...
  created_at timestamptz not null default now()
);
create index if not exists screen_events_session_t on public.screen_events (session_id, t);

alter table public.screen_events enable row level security;
