import { useEffect, useState } from 'react';
import { getTelegramWebApp } from '../lib/telegram';
import { configured, setTelegramAuthProof, supabase } from '../lib/supabase';
export interface TelegramIdentity { telegramUserId: number; firstName: string | null; username: string | null }
export type AuthStatus = 'loading' | 'ready' | 'not-telegram' | 'error';
export const isDemo = import.meta.env.DEV && !getTelegramWebApp()?.initData;
export function useTelegramAuth() {
  const [status, setStatus] = useState<AuthStatus>('loading'), [identity, setIdentity] = useState<TelegramIdentity | null>(null), [error, setError] = useState<string | null>(null);
  useEffect(() => { let cancelled = false;
    async function run() {
      try {
        const tg = getTelegramWebApp(); tg?.ready(); tg?.expand();
        if (isDemo) { if (!cancelled) { setIdentity({ telegramUserId: 1, firstName: 'Демо', username: null }); setStatus('ready'); } return; }
        if (!tg?.initData) { if (!cancelled) setStatus('not-telegram'); return; }
        if (!configured) throw new Error('Не настроено подключение к базе.');
        const { data, error: e } = await supabase.functions.invoke('verify-init-data', { body: { initData: tg.initData } });
        if (e || !data?.sig || !Number.isSafeInteger(data.telegram_user_id) || !data.exp) throw new Error('Не удалось подтвердить вход. Закрой миниапку и открой снова.');
        if (cancelled) return;
        setTelegramAuthProof({ telegramUserId: data.telegram_user_id, sig: data.sig, exp: data.exp });
        setIdentity({ telegramUserId: data.telegram_user_id, firstName: data.first_name, username: data.username }); setStatus('ready');
      } catch (e) { if (!cancelled) { setError(e instanceof Error ? e.message : 'Ошибка входа'); setStatus('error'); } }
    }
    void run(); return () => { cancelled = true; };
  }, []);
  return { status, identity, error };
}
