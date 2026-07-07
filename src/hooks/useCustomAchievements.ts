import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { CustomAchievement } from "../types";

export function useCustomAchievements(telegramUserId: number | null) {
  const [items, setItems] = useState<CustomAchievement[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!telegramUserId) return;
    const { data, error: loadError } = await supabase
      .from("user_custom_achievements")
      .select("*")
      .eq("telegram_user_id", telegramUserId)
      .order("created_at", { ascending: true });
    if (!loadError && data) {
      setItems(data as CustomAchievement[]);
    } else {
      setError("Не удалось загрузить свои достижения — проверь интернет и открой приложение заново.");
    }
    setLoaded(true);
  }, [telegramUserId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const clearError = useCallback(() => setError(null), []);

  /** Returns true when the achievement was saved; the form keeps the text on failure. */
  const addCustom = useCallback(
    async (text: string): Promise<boolean> => {
      if (!telegramUserId) return false;
      const trimmed = text.trim();
      if (!trimmed) return false;
      const { data, error: insertError } = await supabase
        .from("user_custom_achievements")
        .insert({ telegram_user_id: telegramUserId, text: trimmed })
        .select()
        .single();
      if (insertError || !data) return false;
      setItems((prev) => [...prev, data as CustomAchievement]);
      return true;
    },
    [telegramUserId],
  );

  const removeCustom = useCallback(
    async (id: string) => {
      setItems((prev) => prev.filter((item) => item.id !== id));
      const { error: deleteError } = await supabase
        .from("user_custom_achievements")
        .delete()
        .eq("id", id);
      if (deleteError) {
        setError("Не получилось удалить — попробуй ещё раз.");
        reload();
      }
    },
    [reload],
  );

  const toggleCustom = useCallback(async (id: string) => {
    let nextStatus = false;
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        nextStatus = !item.status;
        return { ...item, status: nextStatus };
      }),
    );
    const { error: updateError } = await supabase
      .from("user_custom_achievements")
      .update({ status: nextStatus })
      .eq("id", id);
    if (updateError) {
      setItems((prev) => prev.map((item) => (item.id === id ? { ...item, status: !nextStatus } : item)));
      setError("Не получилось сохранить отметку — попробуй ещё раз.");
    }
  }, []);

  return { items, loaded, addCustom, toggleCustom, removeCustom, error, clearError };
}
