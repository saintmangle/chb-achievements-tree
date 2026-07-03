import type { ProgressMap } from "../types";
import type { LeafCluster, Point, TreeLayout } from "./types";

// Everything is rasterized onto a fixed square grid of PIXEL×PIXEL world
// units — axis-aligned, uniform-size "fat pixels", like squares on grid paper.
const PIXEL = 3;

const COLORS = {
  wood: "#4a3222",
  root: "#33241a",
  leafOff: "#c9c4a0",
  leafOn: "#57cf7c",
  leafOnHighlight: "#8af0a8",
  leafOffHighlight: "#efe9c8",
};

const FOLIAGE_COLORS = ["#35583a", "#3f6b40", "#4c7a49"];

type Rgb = [number, number, number];

const WOOD_RGB: Rgb = [74, 50, 34];

function hslToRgb(h: number, s: number, l: number): Rgb {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function rgbString([r, g, b]: Rgb): string {
  return `rgb(${r}, ${g}, ${b})`;
}

// Muted, dark per-branch hues. Golden-angle spacing keeps neighbouring
// branch ids far apart on the wheel; low saturation + a blend toward the
// trunk brown keeps everything wooden rather than neon.
function branchRgb(branchId: number): Rgb {
  const hue = (branchId * 137.5) % 360;
  return lerpRgb(hslToRgb(hue, 0.34, 0.32), WOOD_RGB, 0.35);
}

function branchColor(branchId: number): string {
  return rgbString(branchRgb(branchId));
}

function branchStubColor(branchId: number): string {
  return rgbString(lerpRgb(branchRgb(branchId), [220, 210, 190], 0.18));
}

function cellOf(v: number): number {
  return Math.round(v / PIXEL);
}

/** Bresenham line in grid-cell space; every stamp is an axis-aligned block of whole cells. */
function drawPixelLine(
  ctx: CanvasRenderingContext2D,
  a: Point,
  b: Point,
  width: number,
  color: string,
) {
  let x0 = cellOf(a.x);
  let y0 = cellOf(a.y);
  const x1 = cellOf(b.x);
  const y1 = cellOf(b.y);
  const w = Math.max(1, Math.round(width / PIXEL));
  const half = Math.floor(w / 2);

  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  ctx.fillStyle = color;
  for (;;) {
    ctx.fillRect((x0 - half) * PIXEL, (y0 - half) * PIXEL, w * PIXEL, w * PIXEL);
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

/** Every leaf block is exactly one grid cell — same size everywhere. */
function drawLeafCluster(ctx: CanvasRenderingContext2D, leaf: LeafCluster, color: string) {
  ctx.fillStyle = color;
  for (const block of leaf.blocks) {
    ctx.fillRect(cellOf(block.x) * PIXEL, cellOf(block.y) * PIXEL, PIXEL, PIXEL);
  }
  ctx.fillRect(cellOf(leaf.center.x) * PIXEL, cellOf(leaf.center.y) * PIXEL, PIXEL, PIXEL);
}

function achievementLeafColor(completed: boolean, highlighted: boolean): string {
  return completed
    ? highlighted
      ? COLORS.leafOnHighlight
      : COLORS.leafOn
    : highlighted
      ? COLORS.leafOffHighlight
      : COLORS.leafOff;
}

/**
 * Trunk painted as vertical stripes: the trunk's width is divided into
 * one-cell-wide strips, colored left-to-right with the branch hues (left-side
 * branches first, then right-side — matching layout order), blended toward
 * wood so it reads as tinted bark.
 */
function drawTrunkStripes(ctx: CanvasRenderingContext2D, layout: TreeLayout) {
  const { trunk } = layout;
  const stripeColors = layout.branches.map((b) => branchRgb(b.branchId));
  const n = stripeColors.length;

  const colorAt = (u: number): Rgb => {
    if (n === 0) return WOOD_RGB;
    if (n === 1) return stripeColors[0];
    const pos = Math.min(1, Math.max(0, u)) * (n - 1);
    const i = Math.min(n - 2, Math.floor(pos));
    return lerpRgb(stripeColors[i], stripeColors[i + 1], pos - i);
  };

  for (let i = 0; i < trunk.path.length - 1; i++) {
    const width = trunk.widths[i];
    const wCells = Math.max(1, Math.round(width / PIXEL));
    for (let j = 0; j < wCells; j++) {
      const u = wCells === 1 ? 0.5 : j / (wCells - 1);
      const rgb = lerpRgb(colorAt(u), WOOD_RGB, 0.5);
      const dx = (j - (wCells - 1) / 2) * PIXEL;
      drawPixelLine(
        ctx,
        { x: trunk.path[i].x + dx, y: trunk.path[i].y },
        { x: trunk.path[i + 1].x + dx, y: trunk.path[i + 1].y },
        PIXEL,
        rgbString(rgb),
      );
    }
  }
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
  // Integer translation keeps the fat-pixel grid aligned to canvas pixels.
  ctx.translate(Math.round(-bounds.minX), Math.round(-bounds.minY));

  for (const g of layout.groundRoots) {
    drawTaperedPath(ctx, g.path, g.baseWidth, g.tipWidth, COLORS.root);
  }

  for (const root of layout.roots) {
    drawTaperedPath(ctx, root.path, root.baseWidth, root.tipWidth, COLORS.root);
    drawLeafCluster(
      ctx,
      root.leaf,
      achievementLeafColor(root.status, options.highlightedId === root.customId),
    );
  }

  drawTrunkStripes(ctx, layout);

  for (const branch of layout.branches) {
    drawTaperedPath(ctx, branch.path, branch.baseWidth, branch.tipWidth, branchColor(branch.branchId));
    branch.foliage.forEach((leaf, i) => {
      drawLeafCluster(ctx, leaf, FOLIAGE_COLORS[(branch.branchId * 7 + i) % FOLIAGE_COLORS.length]);
    });
    for (const twig of branch.twigs) {
      drawPixelLine(ctx, twig.stub[0], twig.stub[1], PIXEL, branchStubColor(branch.branchId));
    }
    for (const twig of branch.twigs) {
      const completed = Boolean(options.progress[twig.achievementId]);
      drawLeafCluster(
        ctx,
        twig.leaf,
        achievementLeafColor(completed, options.highlightedId === twig.achievementId),
      );
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
