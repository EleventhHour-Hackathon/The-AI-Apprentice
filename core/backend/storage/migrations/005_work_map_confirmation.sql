-- The teach-back the expert confirmed and their words confirming it: {teach_back, said, t}.
alter table public.work_maps add column if not exists confirmation jsonb;
