import { useState } from "react";

interface AchievementFormProps {
  onAdd: (text: string) => Promise<void>;
  limitReached?: boolean;
}

export function AchievementForm({ onAdd, limitReached }: AchievementFormProps) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    await onAdd(text);
    setSubmitting(false);
    setText("");
    setOpen(false);
  }

  if (limitReached) {
    return (
      <button className="add-root-fab" disabled>
        достигнут лимит: 20 своих достижений
      </button>
    );
  }

  if (!open) {
    return (
      <button className="add-root-fab" onClick={() => setOpen(true)}>
        + своё достижение
      </button>
    );
  }

  return (
    <form className="add-root-form" onSubmit={handleSubmit}>
      <textarea
        autoFocus
        maxLength={280}
        placeholder="Придумай своё достижение — оно прорастёт корнем у ствола"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="add-root-actions">
        <button type="button" onClick={() => setOpen(false)} disabled={submitting}>
          отмена
        </button>
        <button type="submit" disabled={submitting || !text.trim()}>
          добавить
        </button>
      </div>
    </form>
  );
}
