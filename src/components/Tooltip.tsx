interface TooltipProps {
  title: string;
  subtitle?: string;
  description?: string;
  completed: boolean;
  onToggle: () => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function Tooltip({ title, subtitle, description, completed, onToggle, onDelete, onClose }: TooltipProps) {
  return (
    <div className="tooltip-anchor">
      <div className="tooltip-card">
        <button className="tooltip-close" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
        <div className="tooltip-title">{title}</div>
        {subtitle && <div className="tooltip-subtitle">{subtitle}</div>}
        {description && <div className="tooltip-description">{description}</div>}
        <label className="tooltip-check">
          <input type="checkbox" checked={completed} onChange={onToggle} />
          <span>{completed ? "выполнено" : "отметить выполненным"}</span>
        </label>
        {onDelete && (
          <button className="tooltip-delete" onClick={onDelete}>
            удалить
          </button>
        )}
      </div>
    </div>
  );
}
