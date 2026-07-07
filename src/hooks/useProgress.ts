import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { ProgressMap } from "../types";

export function useProgress(telegramUserId: number | null) {
  const [progress, setProgress] = useState<ProgressMap>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!telegramUserId) return;
    let cancelled = false;

    supabase
      .from("user_progress")
      .select("achievement_id")
      .eq("telegram_user_id", telegramUserId)
      .then(({ data, error: loadError }) => {
        if (cancelled) return;
        if (!loadError && data) {
          const map: ProgressMap = {};
          for (const row of data) map[row.achievement_id] = true;
          setProgress(map);
        } else {
          setError("Не удалось загрузить прогресс — проверь интернет и открой приложение заново.");
        }
        setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [telegramUserId]);

  const clearError = useCallback(() => setError(null), []);

  const toggleAchievement = useCallback(
    async (achievementId: string) => {
      if (!telegramUserId) return;
      const wasDone = progress[achievementId];

      setProgress((prev) => {
        const next = { ...prev };
        if (wasDone) delete next[achievementId];
        else next[achievementId] = true;
        return next;
      });

      if (wasDone) {
        const { error: deleteError } = await supabase
          .from("user_progress")
          .delete()
          .eq("telegram_user_id", telegramUserId)
          .eq("achievement_id", achievementId);
        if (deleteError) {
          setProgress((prev) => ({ ...prev, [achievementId]: true }));
          setError("Не получилось сохранить отметку — попробуй ещё раз.");
        }
      } else {
        const { error: insertError } = await supabase
          .from("user_progress")
          .insert({ telegram_user_id: telegramUserId, achievement_id: achievementId });
        if (insertError) {
          setProgress((prev) => {
            const next = { ...prev };
            delete next[achievementId];
            return next;
          });
          setError("Не получилось сохранить отметку — попробуй ещё раз.");
        }
      }
    },
    [telegramUserId, progress],
  );

  return { progress, loaded, toggleAchievement, error, clearError };
}
