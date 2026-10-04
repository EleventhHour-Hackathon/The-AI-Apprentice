-- Screen recordings of a session and the short clips cut from them (storage/media.py).
-- The video itself lives in the private Storage bucket below; these rows say what exists,
-- and go when their Work Map goes.

create table if not exists public.screen_recordings (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.work_maps (id) on delete cascade,
  start_t real not null,          -- session clock, seconds
  end_t real not null,
  object_path text not null unique,
  bytes bigint not null,
  uploaded boolean not null default false,  -- false: only on the backend's disk so far
  created_at timestamptz not null default now(),
  check (end_t > start_t)
);
create index if not exists screen_recordings_session_t on public.screen_recordings (session_id, start_t);

create table if not exists public.screen_clips (
  session_id uuid not null references public.work_maps (id) on delete cascade,
  at numeric(10, 2) not null,     -- the moment the clip is around, session clock (exact, for lookups)
  object_path text not null unique,
  uploaded boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (session_id, at)
);

alter table public.screen_recordings enable row level security;
alter table public.screen_clips enable row level security;

-- Private: only the backend reads it (with the secret key) and hands out short-lived signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('screen-recordings', 'screen-recordings', false, 52428800, array['video/webm', 'video/mp4'])
on conflict (id) do nothing;
