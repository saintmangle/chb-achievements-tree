import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { ProgressMap } from "../types";

export function useProgress(telegramUserId: number | null) {
  const [progress, setProgress] = useState<ProgressMap>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!telegramUserId) return;
    let cancelled = false;

    supabase
      .from("user_progress")
      .select("achievement_id")
      .eq("telegram_user_id", telegramUserId)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && data) {
          const map: ProgressMap = {};
          for (const row of data) map[row.achievement_id] = true;
          setProgress(map);
        }
        setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [telegramUserId]);

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
        const { error } = await supabase
          .from("user_progress")
          .delete()
          .eq("telegram_user_id", telegramUserId)
          .eq("achievement_id", achievementId);
        if (error) setProgress((prev) => ({ ...prev, [achievementId]: true }));
      } else {
        const { error } = await supabase
          .from("user_progress")
          .insert({ telegram_user_id: telegramUserId, achievement_id: achievementId });
        if (error) {
          setProgress((prev) => {
            const next = { ...prev };
            delete next[achievementId];
            return next;
          });
        }
      }
    },
    [telegramUserId, progress],
  );

  return { progress, loaded, toggleAchievement };
}
