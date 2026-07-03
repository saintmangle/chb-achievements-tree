import type { Point } from "../tree/types";

interface TooltipProps {
  anchor: Point;
  title: string;
  subtitle?: string;
  description?: string;
  completed: boolean;
  onToggle: () => void;
  onClose: () => void;
}

export function Tooltip({ anchor, title, subtitle, description, completed, onToggle, onClose }: TooltipProps) {
  const style = {
    left: Math.round(anchor.x),
    top: Math.round(anchor.y),
  };

  return (
    <div className="tooltip-anchor" style={style}>
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
      </div>
    </div>
  );
}
