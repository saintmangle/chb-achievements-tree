import type { ProgressMap } from "../types";
import type { LeafCluster, Point, TreeLayout } from "./types";

const COLORS = {
  wood: "#4a3222",
  root: "#3a2a1c",
  stub: "#5c4530",
  leafOff: "#8a8a72",
  leafOn: "#4fae6b",
  leafOnHighlight: "#6fd98a",
  leafOffHighlight: "#a8a890",
};

/** Bresenham line rasterized as a chain of square "brush" blocks — crisp, no anti-aliasing. */
function drawPixelLine(
  ctx: CanvasRenderingContext2D,
  a: Point,
  b: Point,
  width: number,
  color: string,
) {
  let x0 = Math.round(a.x);
  let y0 = Math.round(a.y);
  const x1 = Math.round(b.x);
  const y1 = Math.round(b.y);
  const w = Math.max(1, Math.round(width));
  const half = Math.floor(w / 2);

  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  ctx.fillStyle = color;
  for (;;) {
    ctx.fillRect(x0 - half, y0 - half, w, w);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
}

function drawTaperedPath(
  ctx: CanvasRenderingContext2D,
  path: Point[],
  baseWidth: number,
  tipWidth: number,
  color: string,
) {
  for (let i = 0; i < path.length - 1; i++) {
    const t = i / Math.max(1, path.length - 2);
    const width = baseWidth + (tipWidth - baseWidth) * t;
    drawPixelLine(ctx, path[i], path[i + 1], width, color);
  }
}

function drawLeafCluster(
  ctx: CanvasRenderingContext2D,
  leaf: LeafCluster,
  completed: boolean,
  highlighted: boolean,
) {
  const color = completed
    ? highlighted
      ? COLORS.leafOnHighlight
      : COLORS.leafOn
    : highlighted
      ? COLORS.leafOffHighlight
      : COLORS.leafOff;
  ctx.fillStyle = color;
  const blockSize = highlighted ? 4 : 3;
  for (const block of leaf.blocks) {
    ctx.fillRect(
      Math.round(block.x - blockSize / 2),
      Math.round(block.y - blockSize / 2),
      blockSize,
      blockSize,
    );
  }
  ctx.fillRect(
    Math.round(leaf.center.x - blockSize / 2),
    Math.round(leaf.center.y - blockSize / 2),
    blockSize,
    blockSize,
  );
}

export interface RenderOptions {
  progress: ProgressMap;
  highlightedId: string | null;
}

export function renderTree(
  ctx: CanvasRenderingContext2D,
  layout: TreeLayout,
  options: RenderOptions,
) {
  const { bounds } = layout;
  const width = Math.ceil(bounds.maxX - bounds.minX);
  const height = Math.ceil(bounds.maxY - bounds.minY);
  if (ctx.canvas.width !== width) ctx.canvas.width = width;
  if (ctx.canvas.height !== height) ctx.canvas.height = height;

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(-bounds.minX, -bounds.minY);

  for (const root of layout.roots) {
    drawTaperedPath(ctx, root.path, root.baseWidth, root.tipWidth, COLORS.root);
    drawLeafCluster(ctx, root.leaf, root.status, options.highlightedId === root.customId);
  }

  drawTaperedPath(ctx, layout.trunk.path, layout.trunk.widths[0], layout.trunk.widths.at(-1)!, COLORS.wood);

  for (const branch of layout.branches) {
    drawTaperedPath(ctx, branch.path, branch.baseWidth, branch.tipWidth, COLORS.wood);
    for (const twig of branch.twigs) {
      drawPixelLine(ctx, twig.stub[0], twig.stub[1], 2, COLORS.stub);
      const completed = Boolean(options.progress[twig.achievementId]);
      drawLeafCluster(ctx, twig.leaf, completed, options.highlightedId === twig.achievementId);
    }
  }

  ctx.restore();
}

export interface HitTarget {
  kind: "achievement" | "custom";
  id: string;
  screenAnchor: Point;
}

/** World-space hit test against every leaf cluster (twigs + root tips). */
export function hitTest(layout: TreeLayout, worldPoint: Point, worldRadius: number): HitTarget | null {
  let best: { target: HitTarget; distSq: number } | null = null;

  for (const branch of layout.branches) {
    for (const twig of branch.twigs) {
      const d = distSq(worldPoint, twig.leaf.center);
      const r = twig.leaf.radius + worldRadius;
      if (d <= r * r && (!best || d < best.distSq)) {
        best = { target: { kind: "achievement", id: twig.achievementId, screenAnchor: twig.leaf.center }, distSq: d };
      }
    }
  }
  for (const root of layout.roots) {
    const d = distSq(worldPoint, root.leaf.center);
    const r = root.leaf.radius + worldRadius;
    if (d <= r * r && (!best || d < best.distSq)) {
      best = { target: { kind: "custom", id: root.customId, screenAnchor: root.leaf.center }, distSq: d };
    }
  }

  return best?.target ?? null;
}

function distSq(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}
