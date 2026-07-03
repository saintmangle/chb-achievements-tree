import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { CustomAchievement } from "../types";

export function useCustomAchievements(telegramUserId: number | null) {
  const [items, setItems] = useState<CustomAchievement[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    if (!telegramUserId) return;
    const { data, error } = await supabase
      .from("user_custom_achievements")
      .select("*")
      .eq("telegram_user_id", telegramUserId)
      .order("created_at", { ascending: true });
    if (!error && data) setItems(data as CustomAchievement[]);
    setLoaded(true);
  }, [telegramUserId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const addCustom = useCallback(
    async (text: string) => {
      if (!telegramUserId) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      const { data, error } = await supabase
        .from("user_custom_achievements")
        .insert({ telegram_user_id: telegramUserId, text: trimmed })
        .select()
        .single();
      if (!error && data) {
        setItems((prev) => [...prev, data as CustomAchievement]);
      }
    },
    [telegramUserId],
  );

  const removeCustom = useCallback(
    async (id: string) => {
      setItems((prev) => prev.filter((item) => item.id !== id));
      const { error } = await supabase.from("user_custom_achievements").delete().eq("id", id);
      if (error) reload();
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
    const { error } = await supabase.from("user_custom_achievements").update({ status: nextStatus }).eq("id", id);
    if (error) {
      setItems((prev) => prev.map((item) => (item.id === id ? { ...item, status: !nextStatus } : item)));
    }
  }, []);

  return { items, loaded, addCustom, toggleCustom, removeCustom };
}
