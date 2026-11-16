import { createClient } from '@supabase/supabase-js';
export const configured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
export interface TelegramAuthProof { telegramUserId: number; exp: number; sig: string }
let proof: TelegramAuthProof | null = null;
export function setTelegramAuthProof(value: TelegramAuthProof | null) { proof = value; }
export function getTelegramAuthProof() { return proof; }
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL || 'https://example.supabase.co', import.meta.env.VITE_SUPABASE_ANON_KEY || 'unconfigured', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => {
    const headers = new Headers(init?.headers);
    if (proof) { headers.set('x-tg-id', String(proof.telegramUserId)); headers.set('x-tg-exp', String(proof.exp)); headers.set('x-tg-sig', proof.sig); }
    return fetch(input, { ...init, headers });
  } },
});
