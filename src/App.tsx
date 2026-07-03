import { useMemo, useRef, useState } from "react";
import { AchievementForm } from "./components/AchievementForm";
import { Tooltip } from "./components/Tooltip";
import { achievements, branches } from "./data/achievements";
import { useCustomAchievements } from "./hooks/useCustomAchievements";
import { useProgress } from "./hooks/useProgress";
import { useTelegramAuth } from "./hooks/useTelegramAuth";
import { buildTreeLayout } from "./tree/layout";
import { TreeCanvas, type TreeCanvasHandle } from "./tree/TreeCanvas";
import type { HitTarget } from "./tree/renderer";
import type { Point } from "./tree/types";

const achievementById = new Map(achievements.map((a) => [a.id, a]));

interface Selection {
  target: HitTarget;
  screen: Point;
}

export default function App() {
  const { status, identity, error } = useTelegramAuth();
  const telegramUserId = identity?.telegramUserId ?? null;

  const { progress, toggleAchievement } = useProgress(telegramUserId);
  const { items: customAchievements, addCustom, toggleCustom } = useCustomAchievements(telegramUserId);

  const layout = useMemo(
    () => buildTreeLayout(branches, achievements, customAchievements),
    [customAchievements],
  );

  const [selection, setSelection] = useState<Selection | null>(null);
  const treeRef = useRef<TreeCanvasHandle>(null);

  const completedCount = Object.keys(progress).length;

  if (status === "loading") {
    return <div className="status-screen">загружаем дерево…</div>;
  }
  if (status === "not-telegram") {
    return (
      <div className="status-screen">
        Открой это приложение через Telegram-бота — вне Telegram оно не может подтвердить, кто ты.
      </div>
    );
  }
  if (status === "error") {
    return <div className="status-screen">{error ?? "Что-то пошло не так"}</div>;
  }

  const selectedContent = (() => {
    if (!selection) return null;
    if (selection.target.kind === "achievement") {
      const a = achievementById.get(selection.target.id);
      if (!a) return null;
      return {
        title: a.title,
        description: a.description as string | undefined,
        completed: Boolean(progress[a.id]),
        onToggle: () => toggleAchievement(a.id),
      };
    }
    const custom = customAchievements.find((c) => c.id === selection.target.id);
    if (!custom) return null;
    return {
      title: custom.text,
      description: undefined,
      completed: custom.status,
      onToggle: () => toggleCustom(custom.id),
    };
  })();

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">Ачивки в реальной жизни</div>
        <div className="app-progress">
          {completedCount} / {achievements.length}
        </div>
        <button className="fit-all-btn" onClick={() => treeRef.current?.fitAll()}>
          показать всё
        </button>
      </header>

      <div className="tree-wrapper">
        <TreeCanvas
          ref={treeRef}
          layout={layout}
          progress={progress}
          activeId={selection?.target.id ?? null}
          onSelect={(target, screen) => {
            if (!target || !screen) {
              setSelection(null);
              return;
            }
            setSelection({ target, screen });
          }}
        />
        {selection && selectedContent && (
          <Tooltip
            anchor={selection.screen}
            title={selectedContent.title}
            description={selectedContent.description}
            completed={selectedContent.completed}
            onToggle={selectedContent.onToggle}
            onClose={() => setSelection(null)}
          />
        )}
      </div>

      <footer className="app-footer">
        <AchievementForm onAdd={addCustom} />
      </footer>
    </div>
  );
}
