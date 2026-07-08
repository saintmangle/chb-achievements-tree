import { useMemo, useRef, useState } from "react";
import { AchievementForm } from "./components/AchievementForm";
import { AchievementList } from "./components/AchievementList";
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
const branchById = new Map(branches.map((b) => [b.id, b]));

// Roots get visually crowded past this point, and it keeps the table tidy.
const MAX_CUSTOM_ACHIEVEMENTS = 20;

interface Selection {
  target: HitTarget;
  screen: Point;
}

export default function App() {
  const { status, identity, error } = useTelegramAuth();
  const telegramUserId = identity?.telegramUserId ?? null;

  const {
    progress,
    toggleAchievement,
    error: progressError,
    clearError: clearProgressError,
  } = useProgress(telegramUserId);
  const {
    items: customAchievements,
    addCustom,
    toggleCustom,
    removeCustom,
    error: customError,
    clearError: clearCustomError,
  } = useCustomAchievements(telegramUserId);

  const layout = useMemo(
    () => buildTreeLayout(branches, achievements, customAchievements),
    [customAchievements],
  );

  const [selection, setSelection] = useState<Selection | null>(null);
  const [showList, setShowList] = useState(false);
  const treeRef = useRef<TreeCanvasHandle>(null);

  const completedCount =
    Object.keys(progress).length + customAchievements.filter((c) => c.status).length;
  const totalCount = achievements.length + customAchievements.length;

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
        title: `${a.id} · ${a.title}`,
        subtitle: branchById.get(a.branch_id)?.title,
        description: a.description as string | undefined,
        completed: Boolean(progress[a.id]),
        onToggle: () => toggleAchievement(a.id),
      };
    }
    const custom = customAchievements.find((c) => c.id === selection.target.id);
    if (!custom) return null;
    return {
      title: custom.text,
      subtitle: "своё достижение",
      description: undefined,
      completed: custom.status,
      onToggle: () => toggleCustom(custom.id),
      onDelete: () => {
        if (window.confirm("Удалить это достижение навсегда?")) {
          removeCustom(custom.id);
          setSelection(null);
        }
      },
    };
  })();

  const notice = progressError ?? customError;
  const dismissNotice = () => {
    clearProgressError();
    clearCustomError();
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Ачивки в реальной жизни</h1>
        <button className="fit-all-btn" onClick={() => setShowList(true)}>
          список · {completedCount}/{totalCount}
        </button>
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
            title={selectedContent.title}
            subtitle={selectedContent.subtitle}
            description={selectedContent.description}
            completed={selectedContent.completed}
            onToggle={selectedContent.onToggle}
            onDelete={"onDelete" in selectedContent ? selectedContent.onDelete : undefined}
            onClose={() => setSelection(null)}
          />
        )}
        {notice && (
          <div className="notice" role="alert">
            <span>{notice}</span>
            <button className="notice-close" onClick={dismissNotice} aria-label="Закрыть">
              ×
            </button>
          </div>
        )}
        {showList && (
          <AchievementList
            progress={progress}
            customAchievements={customAchievements}
            onToggle={toggleAchievement}
            onToggleCustom={toggleCustom}
            onRemoveCustom={removeCustom}
            onClose={() => setShowList(false)}
          />
        )}
      </div>

      <footer className="app-footer">
        <AchievementForm
          onAdd={addCustom}
          limitReached={customAchievements.length >= MAX_CUSTOM_ACHIEVEMENTS}
        />
      </footer>
    </div>
  );
}
