import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set");
}

// The verify-init-data edge function hands the client a short-lived HMAC proof
// of its telegram_user_id. We attach it to every request as custom headers;
// Postgres RLS re-verifies the signature (see supabase/migrations/0001_init.sql).
// The proof isn't known yet at client-creation time, so requests are routed
// through a fetch wrapper that reads the latest value from this mutable ref.
export interface TelegramAuthProof {
  telegramUserId: number;
  exp: number;
  sig: string;
}

const authProof: { current: TelegramAuthProof | null } = { current: null };

export function setTelegramAuthProof(proof: TelegramAuthProof | null) {
  authProof.current = proof;
}

export function getTelegramAuthProof() {
  return authProof.current;
}

export const supabase = createClient(url, anonKey, {
  global: {
    fetch: (input, init) => {
      const proof = authProof.current;
      const headers = new Headers(init?.headers);
      if (proof) {
        headers.set("x-tg-id", String(proof.telegramUserId));
        headers.set("x-tg-exp", String(proof.exp));
        headers.set("x-tg-sig", proof.sig);
      }
      return fetch(input, { ...init, headers });
    },
  },
});
