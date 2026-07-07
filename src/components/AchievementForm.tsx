import { useState } from "react";

interface AchievementFormProps {
  onAdd: (text: string) => Promise<boolean>;
  limitReached?: boolean;
}

export function AchievementForm({ onAdd, limitReached }: AchievementFormProps) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    const saved = await onAdd(text);
    setSubmitting(false);
    if (saved) {
      setText("");
      setOpen(false);
    } else {
      // Keep the text so the user can retry without retyping.
      setError("Не получилось сохранить — проверь интернет и попробуй ещё раз.");
    }
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
        aria-label="Текст своего достижения"
        placeholder="Придумай своё достижение — оно прорастёт корнем у ствола"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
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
