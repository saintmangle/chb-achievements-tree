import { useCallback, useEffect, useRef, useState } from 'react';
import seed from '../data/achievements_data.json';
import { supabase } from '../lib/supabase';
import { isDemo } from './useTelegramAuth';
import type { Achievement, Branch, CustomAchievement } from '../types';
export interface CatalogAchievement extends Achievement { icon_url?: string | null; active?: boolean }
export interface CatalogBranch extends Branch { sort_order?: number; color?: string; background_url?: string | null; active?: boolean }
interface Data { branches: CatalogBranch[]; achievements: CatalogAchievement[]; progress: Record<string, boolean>; custom: CustomAchievement[]; notes: Record<string, string>; visuals: Record<number, number>; admin: boolean }
function branchLabels(branches: CatalogBranch[]) { return branches.map(b => b.id === 9 && b.title === 'Ветка знаний' ? { ...b, title: 'Ветка знания' } : b); }
const initial: Data = { branches: seed.branches, achievements: seed.achievements, progress: {}, custom: [], notes: {}, visuals: {}, admin: false };
const storageKey = 'chb-redesign-demo-v1';
function readDemo(): Data { try { const saved = JSON.parse(localStorage.getItem(storageKey) || 'null'); return saved?.achievements ? { ...initial, ...saved, branches: branchLabels(saved.branches || initial.branches), admin: true } : { ...initial, admin: true }; } catch { return { ...initial, admin: true }; } }
export function useAppData(userId: number | null) {
  const [data, setData] = useState<Data>(isDemo ? readDemo : initial), [loading, setLoading] = useState(true), [ready, setReady] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const lock = useRef(false), state = useRef(data); state.current = data;
  const reload = useCallback(async () => {
    if (!userId) return;
    if (isDemo) { setReady(true); setLoading(false); return; }
    const results = await Promise.all([
      supabase.from('achievement_branches').select('*').order('sort_order'),
      supabase.from('achievement_catalog').select('*').order('order'),
      supabase.from('user_progress').select('achievement_id').eq('telegram_user_id', userId),
      supabase.from('user_custom_achievements').select('*').eq('telegram_user_id', userId).order('created_at'),
      supabase.from('achievement_notes').select('achievement_id,note').eq('telegram_user_id', userId),
      supabase.from('branch_visual_progress').select('branch_id,ratio').eq('telegram_user_id', userId),
      supabase.rpc('is_app_admin'),
    ]);
    const fail = results.find(r => r.error); if (fail?.error) throw new Error('Не удалось загрузить данные. Проверь соединение; если это первое включение новой версии, нужна миграция базы.');
    const [b,a,p,c,n,v,ad] = results;
    const next: Data = { branches: branchLabels(b.data as CatalogBranch[]), achievements: a.data as CatalogAchievement[], progress: Object.fromEntries((p.data ?? []).map(x => [x.achievement_id, true])), custom: c.data as CustomAchievement[], notes: Object.fromEntries((n.data ?? []).map(x => [x.achievement_id, x.note])), visuals: Object.fromEntries((v.data ?? []).map(x => [x.branch_id, Number(x.ratio)])), admin: Boolean(ad.data) };
    state.current = next; setData(next); setReady(true); setLoading(false);
  }, [userId]);
  useEffect(() => { if (userId) { setLoading(true); void reload().catch(e => { setError(e.message); setLoading(false); }); } }, [userId, reload]);
  async function mutate(remote: () => PromiseLike<{ error: { message: string } | null }>, local: (d: Data) => Data, refresh?: () => Promise<Partial<Data>>) {
    if (!userId || lock.current) return false; lock.current = true; setBusy(true); setError('');
    try {
      if (isDemo) { const next = local(state.current); localStorage.setItem(storageKey, JSON.stringify(next)); state.current = next; setData(next); }
      else {
        const result = await remote(); if (result.error) throw new Error(result.error.message);
        const next = local(state.current); state.current = next; setData(next);
        if (refresh) {
          try { const patch = await refresh(); const synced = { ...state.current, ...patch }; state.current = synced; setData(synced); }
          catch { setError('Изменение сохранено, но не удалось обновить данные. Нажми «Повторить загрузку».'); }
        }
      }
      return true;
    } catch (e) { setError('Не получилось сохранить: ' + (e instanceof Error ? e.message : 'проверь соединение')); return false; }
    finally { lock.current = false; setBusy(false); }
  }
  function toggle(id: string) {
    const wasDone = Boolean(state.current.progress[id]);
    return mutate(() => wasDone ? supabase.from('user_progress').delete().eq('telegram_user_id', userId!).eq('achievement_id', id) : supabase.from('user_progress').upsert({ telegram_user_id: userId, achievement_id: id }), d => {
      const progress = { ...d.progress }; if (wasDone) delete progress[id]; else progress[id] = true;
      const b = d.achievements.find(a => a.id === id)?.branch_id ?? 0, count = d.achievements.filter(a => a.branch_id === b && a.active !== false).length || 1;
      const actual = d.achievements.filter(a => a.branch_id === b && a.active !== false && progress[a.id]).length / count;
      const previous = d.visuals[b] ?? 0;
      return { ...d, progress, visuals: { ...d.visuals, [b]: wasDone ? Math.max(actual, previous - 1 / count) : Math.min(1, Math.max(actual, previous + 1 / count)) } };
    }, async () => {
      const [p,v] = await Promise.all([
        supabase.from('user_progress').select('achievement_id').eq('telegram_user_id', userId!),
        supabase.from('branch_visual_progress').select('branch_id,ratio').eq('telegram_user_id', userId!),
      ]);
      if (p.error || v.error) throw new Error('Progress refresh failed');
      return { progress: Object.fromEntries((p.data ?? []).map(x => [x.achievement_id, true])), visuals: Object.fromEntries((v.data ?? []).map(x => [x.branch_id, Number(x.ratio)])) };
    });
  }
  function saveNote(id: string, note: string) { return mutate(() => supabase.from('achievement_notes').upsert({ telegram_user_id: userId, achievement_id: id, note }), d => ({ ...d, notes: { ...d.notes, [id]: note } })); }
  function addCustom(text: string) {
    if (state.current.custom.length >= 67 || !text.trim()) return Promise.resolve(false);
    let created: CustomAchievement = { id: crypto.randomUUID(), telegram_user_id: userId!, text: text.trim(), status: false, created_at: new Date().toISOString() };
    return mutate(async () => {
      const result = await supabase.from('user_custom_achievements').insert({ telegram_user_id: userId, text: text.trim() }).select('*').single();
      if (result.data) created = result.data as CustomAchievement;
      return result;
    }, d => ({ ...d, custom: [...d.custom, created] }));
  }
  function toggleCustom(id: string) { const status = !state.current.custom.find(a => a.id === id)?.status; return mutate(() => supabase.from('user_custom_achievements').update({ status }).eq('id', id).eq('telegram_user_id', userId!), d => ({ ...d, custom: d.custom.map(a => a.id === id ? { ...a, status } : a) })); }
  function removeCustom(id: string) { return mutate(() => supabase.from('user_custom_achievements').delete().eq('id', id).eq('telegram_user_id', userId!), d => { const notes = { ...d.notes }; delete notes[id]; return { ...d, notes, custom: d.custom.filter(a => a.id !== id) }; }); }
  function saveCatalog(achievements: CatalogAchievement[], branches: CatalogBranch[] = []) {
    return mutate(() => supabase.rpc('admin_save_catalog', { p_achievements: achievements, p_branches: branches }), d => ({ ...d, achievements: [...d.achievements.filter(a => !achievements.some(x => x.id === a.id)), ...achievements].sort((a,b) => a.order-b.order), branches: [...d.branches.filter(b => !branches.some(x => x.id === b.id)), ...branches].sort((a,b) => (a.sort_order ?? a.id)-(b.sort_order ?? b.id)) }), async () => { await reload(); return {}; });
  }
  return { data, loading, ready, busy, error, setError, reload, toggle, saveNote, addCustom, toggleCustom, removeCustom, saveCatalog };
}
