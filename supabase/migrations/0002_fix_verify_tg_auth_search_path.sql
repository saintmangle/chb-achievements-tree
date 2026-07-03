-- Fix: on Supabase, pgcrypto (hmac/digest) lives in the `extensions` schema,
-- but verify_tg_auth() pinned search_path to `public` only — so every call
-- failed with "function hmac(text, text, unknown) does not exist" and RLS
-- rejected all reads/writes. Adding `extensions` to the search_path fixes it.

create or replace function verify_tg_auth(p_telegram_user_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
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
