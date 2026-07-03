import { useEffect, useState } from "react";
import { getTelegramWebApp } from "../lib/telegram";
import { setTelegramAuthProof, supabase } from "../lib/supabase";

export interface TelegramIdentity {
  telegramUserId: number;
  firstName: string | null;
  username: string | null;
}

export type AuthStatus = "loading" | "ready" | "not-telegram" | "error";

export function useTelegramAuth() {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [identity, setIdentity] = useState<TelegramIdentity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const webApp = getTelegramWebApp();
      webApp?.ready();
      webApp?.expand();

      if (!webApp?.initData) {
        if (!cancelled) setStatus("not-telegram");
        return;
      }

      const { data, error: invokeError } = await supabase.functions.invoke("verify-init-data", {
        body: { initData: webApp.initData },
      });

      if (cancelled) return;

      if (invokeError || !data?.telegram_user_id) {
        setTelegramAuthProof(null);
        setError("Не удалось подтвердить пользователя Telegram");
        setStatus("error");
        return;
      }

      setTelegramAuthProof({
        telegramUserId: data.telegram_user_id,
        exp: data.exp,
        sig: data.sig,
      });
      setIdentity({
        telegramUserId: data.telegram_user_id,
        firstName: data.first_name ?? null,
        username: data.username ?? null,
      });
      setStatus("ready");
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return { status, identity, error };
}
