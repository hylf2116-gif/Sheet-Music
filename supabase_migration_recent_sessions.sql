-- Run this in the Supabase dashboard → SQL Editor

create table if not exists recent_sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users(id) on delete cascade not null,
  room_id        text not null,
  score_name     text not null default 'Untitled Score',
  last_accessed  timestamptz not null default now(),
  constraint recent_sessions_user_room_unique unique (user_id, room_id)
);

alter table recent_sessions enable row level security;

create policy "select own sessions"
  on recent_sessions for select
  using (auth.uid() = user_id);

create policy "insert own sessions"
  on recent_sessions for insert
  with check (auth.uid() = user_id);

create policy "update own sessions"
  on recent_sessions for update
  using (auth.uid() = user_id);

create policy "delete own sessions"
  on recent_sessions for delete
  using (auth.uid() = user_id);

-- Allows a user to delete their own account from the client side.
create or replace function delete_own_user()
returns void language plpgsql security definer set search_path = auth
as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$;
