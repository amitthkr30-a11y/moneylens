-- MoneyLens India: Supabase setup (run ONCE in Supabase → SQL Editor → New query → Run). Safe to re-run.
-- Creates: table public.user_data, private storage bucket "statements", Row Level Security (owner-only).
create table if not exists public.user_data (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.user_data enable row level security;
drop policy if exists "user_data_select_own" on public.user_data;
drop policy if exists "user_data_insert_own" on public.user_data;
drop policy if exists "user_data_update_own" on public.user_data;
drop policy if exists "user_data_delete_own" on public.user_data;
create policy "user_data_select_own" on public.user_data for select to authenticated using (auth.uid() = user_id);
create policy "user_data_insert_own" on public.user_data for insert to authenticated with check (auth.uid() = user_id);
create policy "user_data_update_own" on public.user_data for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "user_data_delete_own" on public.user_data for delete to authenticated using (auth.uid() = user_id);
revoke all on public.user_data from anon;
grant select, insert, update, delete on public.user_data to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('statements', 'statements', false, 15728640)
on conflict (id) do update set public = false, file_size_limit = 15728640;

drop policy if exists "statements_select_own" on storage.objects;
drop policy if exists "statements_insert_own" on storage.objects;
drop policy if exists "statements_update_own" on storage.objects;
drop policy if exists "statements_delete_own" on storage.objects;
create policy "statements_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'statements' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "statements_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'statements' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "statements_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'statements' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'statements' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "statements_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'statements' and (storage.foldername(name))[1] = auth.uid()::text);
-- Check: Table Editor → user_data (RLS enabled); Storage → statements (Private).
