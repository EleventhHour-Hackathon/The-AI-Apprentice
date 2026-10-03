-- Work Maps the apprentice writes at the end of a session (InterviewFlow._save_work_map).
create table if not exists public.work_maps (
  id uuid primary key,
  task text,
  recorded_at timestamptz not null default now(),
  confirmed boolean not null default false,
  steps jsonb not null default '[]',
  guardrails jsonb not null default '[]',
  open_questions jsonb not null default '[]',
  corrections jsonb not null default '[]',
  transcript jsonb not null default '[]'
);
create index if not exists work_maps_recorded_at on public.work_maps (recorded_at desc);

-- Only the backend reads and writes this table, over its own database connection.
-- RLS with no policies keeps it closed to the public Data API and the publishable key.
alter table public.work_maps enable row level security;
