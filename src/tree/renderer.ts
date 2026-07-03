import type { ProgressMap } from "../types";
import type { LeafCluster, Point, TreeLayout } from "./types";

const COLORS = {
  wood: "#4a3222",
  root: "#3a2a1c",
  leafOff: "#8a8a72",
  leafOn: "#4fae6b",
  leafOnHighlight: "#6fd98a",
  leafOffHighlight: "#a8a890",
};

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
  return lerpRgb(hslToRgb(hue, 0.34, 0.35), WOOD_RGB, 0.35);
}

function branchColor(branchId: number): string {
  return rgbString(branchRgb(branchId));
}

function branchStubColor(branchId: number): string {
  return rgbString(lerpRgb(branchRgb(branchId), [220, 210, 190], 0.18));
}

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

  drawTrunkGradient(ctx, layout);

  for (const branch of layout.branches) {
    drawTaperedPath(ctx, branch.path, branch.baseWidth, branch.tipWidth, branchColor(branch.branchId));
    for (const twig of branch.twigs) {
      drawPixelLine(ctx, twig.stub[0], twig.stub[1], 2, branchStubColor(branch.branchId));
      const completed = Boolean(options.progress[twig.achievementId]);
      drawLeafCluster(ctx, twig.leaf, completed, options.highlightedId === twig.achievementId);
    }
  }

  ctx.restore();
}

/**
 * Trunk painted segment-by-segment, blending between the hues of the branches
 * attached at each height — the trunk "carries" every branch's colour up to it.
 */
function drawTrunkGradient(ctx: CanvasRenderingContext2D, layout: TreeLayout) {
  const { trunk } = layout;
  const stops = layout.branches
    .map((b) => ({ t: b.attachT, rgb: branchRgb(b.branchId) }))
    .sort((a, b) => a.t - b.t);

  const colorAt = (t: number): Rgb => {
    if (stops.length === 0) return WOOD_RGB;
    if (t <= stops[0].t) {
      // Below the first branch: fade from plain wood at the base up to its hue.
      const k = stops[0].t <= 0 ? 1 : t / stops[0].t;
      return lerpRgb(WOOD_RGB, stops[0].rgb, k);
    }
    for (let i = 0; i < stops.length - 1; i++) {
      if (t <= stops[i + 1].t) {
        const span = stops[i + 1].t - stops[i].t || 1;
        return lerpRgb(stops[i].rgb, stops[i + 1].rgb, (t - stops[i].t) / span);
      }
    }
    return stops[stops.length - 1].rgb;
  };

  const segments = trunk.path.length - 1;
  for (let i = 0; i < segments; i++) {
    const t = i / Math.max(1, segments - 1);
    const width = trunk.widths[i];
    // Blend halfway back toward wood so the trunk stays woody, just tinted.
    const rgb = lerpRgb(colorAt(t), WOOD_RGB, 0.45);
    drawPixelLine(ctx, trunk.path[i], trunk.path[i + 1], width, rgbString(rgb));
  }
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
