-- Ачивки в реальной жизни — schema init
--
-- Identity model: there is no Supabase Auth session. Every user is identified
-- by their Telegram user id (from `initData`, verified server-side once by the
-- `verify-init-data` Edge Function). The Edge Function hands the client a
-- short-lived proof: (telegram_user_id, exp, sig) where
--   sig = hex(hmac_sha256(secret, telegram_user_id || ':' || exp))
-- The client sends this proof as request headers (x-tg-id / x-tg-exp / x-tg-sig)
-- on every table read/write. RLS policies below re-derive the signature inside
-- Postgres via verify_tg_auth() and only allow access when it matches — so the
-- anon key alone can never be used to read or write another user's rows.

create extension if not exists pgcrypto;

-- Secret store. RLS is enabled with NO policies, so PostgREST (anon/authenticated
-- roles) gets zero direct access — only a SECURITY DEFINER function (owned by the
-- table owner) can read it.
create table if not exists app_secrets (
  key   text primary key,
  value text not null
);
alter table app_secrets enable row level security;

-- Run this once manually (Supabase SQL editor), with the SAME value you set for
-- the `APP_SIGNING_SECRET` edge function secret (see .env / supabase secrets set):
--
--   insert into app_secrets (key, value) values ('app_signing_secret', '<paste the same value>')
--   on conflict (key) do update set value = excluded.value;

create or replace function verify_tg_auth(p_telegram_user_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  secret   text;
  exp_val  bigint;
  sig_val  text;
  expected text;
begin
  select value into secret from app_secrets where key = 'app_signing_secret';
  if secret is null then
    return false;
  end if;

  exp_val := nullif(current_setting('request.headers', true)::json ->> 'x-tg-exp', '')::bigint;
  sig_val := current_setting('request.headers', true)::json ->> 'x-tg-sig';

  if exp_val is null or sig_val is null then
    return false;
  end if;

  if extract(epoch from now()) > exp_val then
    return false;
  end if;

  expected := encode(
    hmac(p_telegram_user_id::text || ':' || exp_val::text, secret, 'sha256'),
    'hex'
  );

  return expected = sig_val;
end;
$$;

revoke all on function verify_tg_auth(bigint) from public;
grant execute on function verify_tg_auth(bigint) to anon, authenticated;

-- Progress on the 155 fixed achievements (achievement catalog itself ships as
-- static JSON in the frontend bundle, not in the DB).
create table if not exists user_progress (
  telegram_user_id bigint not null,
  achievement_id   text   not null,
  completed_at     timestamptz not null default now(),
  primary key (telegram_user_id, achievement_id)
);
alter table user_progress enable row level security;

create policy "own progress only"
  on user_progress
  for all
  using (verify_tg_auth(telegram_user_id))
  with check (verify_tg_auth(telegram_user_id));

-- User-authored "root" achievements (branch 15 — "сделай сам"). Private to
-- their author: never readable by other telegram_user_id values.
create table if not exists user_custom_achievements (
  id               uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null,
  text             text not null check (char_length(text) between 1 and 280),
  status           boolean not null default false,
  created_at       timestamptz not null default now()
);
alter table user_custom_achievements enable row level security;

create policy "own custom achievements only"
  on user_custom_achievements
  for all
  using (verify_tg_auth(telegram_user_id))
  with check (verify_tg_auth(telegram_user_id));
