import { useEffect, useRef } from "react";
import { achievements, branches } from "../data/achievements";
import { branchColor } from "../tree/renderer";
import type { CustomAchievement, ProgressMap } from "../types";

// Grouped once — the fixed achievement data never changes.
const byBranch = new Map<number, typeof achievements>();
for (const a of achievements) {
  const list = byBranch.get(a.branch_id) ?? [];
  list.push(a);
  byBranch.set(a.branch_id, list);
}

// The branch without fixed achievements is the "make your own" one — its
// items are the user's root achievements.
const customBranch = branches.find((b) => !byBranch.has(b.id));

interface AchievementListProps {
  progress: ProgressMap;
  customAchievements: CustomAchievement[];
  onToggle: (id: string) => void;
  onToggleCustom: (id: string) => void;
  onRemoveCustom: (id: string) => void;
  onClose: () => void;
}

export function AchievementList({
  progress,
  customAchievements,
  onToggle,
  onToggleCustom,
  onRemoveCustom,
  onClose,
}: AchievementListProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const customDone = customAchievements.filter((c) => c.status).length;

  return (
    <div className="list-panel" role="dialog" aria-label="Все достижения списком">
      <div className="list-panel-header">
        <h2>Все достижения</h2>
        <button ref={closeRef} className="list-panel-close" onClick={onClose} aria-label="Закрыть список">
          ×
        </button>
      </div>
      <div className="list-panel-body">
        {branches.map((branch) => {
          const items = byBranch.get(branch.id);
          if (!items) return null;
          const done = items.filter((a) => progress[a.id]).length;
          return (
            <section key={branch.id}>
              <h3>
                <span className="branch-dot" style={{ background: branchColor(branch.id) }} aria-hidden="true" />
                <span>
                  {branch.id}. {branch.title}
                </span>
                <span className="branch-count">
                  {done} / {items.length}
                </span>
              </h3>
              <ul>
                {items.map((a) => (
                  <li key={a.id}>
                    <label className={progress[a.id] ? "list-row list-row-done" : "list-row"}>
                      <input
                        type="checkbox"
                        checked={Boolean(progress[a.id])}
                        onChange={() => onToggle(a.id)}
                      />
                      <span className="list-row-text">
                        <span className="list-row-title">
                          {a.id} · {a.title}
                        </span>
                        {a.description && <span className="list-row-desc">{a.description}</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        <section>
          <h3>
            <span>
              {customBranch ? `${customBranch.id}. ${customBranch.title}` : "свои достижения"} (корни)
            </span>
            <span className="branch-count">
              {customDone} / {customAchievements.length}
            </span>
          </h3>
          {customAchievements.length === 0 ? (
            <p className="list-empty">Пока пусто — добавь своё достижение кнопкой под деревом.</p>
          ) : (
            <ul>
              {customAchievements.map((c) => (
                <li key={c.id} className="list-custom-row">
                  <label className={c.status ? "list-row list-row-done" : "list-row"}>
                    <input type="checkbox" checked={c.status} onChange={() => onToggleCustom(c.id)} />
                    <span className="list-row-text">
                      <span className="list-row-title">{c.text}</span>
                    </span>
                  </label>
                  <button
                    className="list-delete"
                    onClick={() => {
                      if (window.confirm("Удалить это достижение навсегда?")) onRemoveCustom(c.id);
                    }}
                  >
                    удалить
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
