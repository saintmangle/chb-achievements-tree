import type { ProgressMap } from "../types";
import { mulberry32 } from "./prng";
import type { LeafCluster, Point, TreeLayout } from "./types";

// Everything is rasterized onto a fixed square grid of PIXEL×PIXEL world
// units — axis-aligned, uniform-size "fat pixels", like squares on grid paper.
const PIXEL = 3;

const COLORS = {
  wood: "#4a3222",
  // Dark halo painted under every branch so it stays readable on the crown.
  branchUnderlay: "#2b1c10",
  fruitOff: "#f2ebcd",
  fruitOffOutline: "#3a2a1a",
  fruitOn: "#57cf7c",
  fruitOnOutline: "#245c34",
  fruitOffHighlight: "#fffbe6",
  fruitOnHighlight: "#8af0a8",
};

// The crown starts cream-white; completing an achievement turns its fruit and
// the foliage around it green, so the tree greens up spot by spot. Each state
// is a lit/base/shaded triple (top of a blob catches light, bottom falls into
// shadow) plus a deep drop-shadow tone that gives the canopy its depth.
interface FoliageShades {
  light: string;
  base: string;
  dark: string;
  shadow: string;
}

const FOLIAGE_CREAM: FoliageShades = {
  light: "#c9c1a2",
  base: "#a89f80",
  dark: "#867e63",
  shadow: "#57503d",
};
const FOLIAGE_GREEN: FoliageShades = {
  light: "#6fae5e",
  base: "#4c8a50",
  dark: "#35663c",
  shadow: "#1d3d26",
};
// Filler foliage (not owned by a fruit) also greens when a completed fruit is
// this close, so a green patch has no cream stragglers inside it.
const GREEN_RADIUS = 85;

// Background palette: banded sky with clouds, a grass lip at the ground line,
// then earth that darkens with depth, speckled and studded with stones.
const SKY_BANDS = ["#2f6bab", "#3d7ab8", "#4f8ec7", "#69a5d6", "#84bce2", "#9ccbe9"];
const CLOUD_MAIN = "#f4f9fc";
const CLOUD_SHADE = "#c9dcea";
const GRASS_BASE = "#5ea23f";
const GRASS_SHADES = ["#4c8f33", "#71b34c", "#3f7a2a"];
const EARTH_BANDS = ["#8a5526", "#774822", "#653a1a", "#523015", "#3f240f"];
const STONE = { light: "#8f8d84", mid: "#75736a", dark: "#5c5a52" };
// World grass thickness in cells; TreeCanvas mirrors it for the CSS backdrop.
export const GRASS_DEPTH_CELLS = 5;

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

// Barely-there per-branch bark tints. Golden-angle spacing keeps neighbouring
// branch ids far apart on the wheel; the heavy blend toward trunk brown makes
// every branch read as wood first, with a warm/cool undertone to tell them
// apart on a second look.
function branchRgb(branchId: number): Rgb {
  const hue = (branchId * 137.5) % 360;
  return lerpRgb(hslToRgb(hue, 0.3, 0.32), WOOD_RGB, 0.65);
}

/** Public: the list view shows this tint as a legend chip next to the branch name. */
export function branchColor(branchId: number): string {
  return rgbString(branchRgb(branchId));
}

function branchStubColor(branchId: number): string {
  return rgbString(lerpRgb(branchRgb(branchId), [220, 210, 190], 0.22));
}

function cellOf(v: number): number {
  return Math.round(v / PIXEL);
}

/** Deterministic per-cell noise in [0, 1) — stable across redraws. */
function cellNoise(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
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

/**
 * A leaf blob shaded by height: the top rows catch light, the bottom rows
 * fall into shade, with a checker dither at the seams so the transition
 * stays pixel-art rather than banding.
 */
function drawLeafCluster(ctx: CanvasRenderingContext2D, leaf: LeafCluster, shades: FoliageShades) {
  const cy0 = cellOf(leaf.center.y);
  let minDy = 0;
  let maxDy = 0;
  for (const block of leaf.blocks) {
    const d = cellOf(block.y) - cy0;
    if (d < minDy) minDy = d;
    if (d > maxDy) maxDy = d;
  }
  const span = Math.max(1, maxDy - minDy);

  const light: Point[] = [];
  const base: Point[] = [];
  const dark: Point[] = [];
  const bucketFor = (cx: number, cy: number): Point[] => {
    const t = (cy - cy0 - minDy) / span; // 0 = top of the blob, 1 = bottom
    const dither = ((cx + cy) & 1) === 0 ? 0.06 : -0.06;
    const v = t + dither;
    return v < 0.3 ? light : v > 0.72 ? dark : base;
  };
  for (const block of leaf.blocks) {
    bucketFor(cellOf(block.x), cellOf(block.y)).push(block);
  }
  bucketFor(cellOf(leaf.center.x), cy0).push(leaf.center);

  const paint = (blocks: Point[], color: string) => {
    if (blocks.length === 0) return;
    ctx.fillStyle = color;
    for (const b of blocks) ctx.fillRect(cellOf(b.x) * PIXEL, cellOf(b.y) * PIXEL, PIXEL, PIXEL);
  };
  paint(light, shades.light);
  paint(base, shades.base);
  paint(dark, shades.dark);
}

/** One-cell drop shadow under a blob — overlapping shadows carve the dark clefts between canopy lumps. */
function drawLeafShadow(ctx: CanvasRenderingContext2D, leaf: LeafCluster, color: string) {
  ctx.fillStyle = color;
  for (const block of leaf.blocks) {
    ctx.fillRect((cellOf(block.x) + 1) * PIXEL, (cellOf(block.y) + 1) * PIXEL, PIXEL, PIXEL);
  }
}

// Achievements are drawn as "fruits": a solid 3×3-cell disc with a dark
// octagonal outline — a clearly clickable button among the loose foliage.
const FRUIT_FILL: Array<[number, number]> = [];
const FRUIT_RING: Array<[number, number]> = [];
for (let dx = -2; dx <= 2; dx++) {
  for (let dy = -2; dy <= 2; dy++) {
    const cheb = Math.max(Math.abs(dx), Math.abs(dy));
    if (cheb <= 1) FRUIT_FILL.push([dx, dy]);
    else if (Math.abs(dx) + Math.abs(dy) <= 3) FRUIT_RING.push([dx, dy]);
  }
}

function drawFruit(ctx: CanvasRenderingContext2D, center: Point, fill: string, outline: string) {
  const cx = cellOf(center.x);
  const cy = cellOf(center.y);
  ctx.fillStyle = outline;
  for (const [dx, dy] of FRUIT_RING) {
    ctx.fillRect((cx + dx) * PIXEL, (cy + dy) * PIXEL, PIXEL, PIXEL);
  }
  ctx.fillStyle = fill;
  for (const [dx, dy] of FRUIT_FILL) {
    ctx.fillRect((cx + dx) * PIXEL, (cy + dy) * PIXEL, PIXEL, PIXEL);
  }
}

function drawAchievementFruit(ctx: CanvasRenderingContext2D, center: Point, completed: boolean, highlighted: boolean) {
  const fill = completed
    ? highlighted
      ? COLORS.fruitOnHighlight
      : COLORS.fruitOn
    : highlighted
      ? COLORS.fruitOffHighlight
      : COLORS.fruitOff;
  drawFruit(ctx, center, fill, completed ? COLORS.fruitOnOutline : COLORS.fruitOffOutline);
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

  // The stripes continue down the underground taproot (groundRoots[0] by
  // construction), so trunk and root read as one striped piece of wood.
  const taproot = layout.groundRoots[0];
  const pre = taproot ? [...taproot.path].reverse().slice(0, -1) : [];
  const path = [...pre, ...trunk.path];
  const widths = [
    ...pre.map((_, i) =>
      taproot.tipWidth + (taproot.baseWidth - taproot.tipWidth) * (i / Math.max(1, pre.length)),
    ),
    ...trunk.widths,
  ];

  for (let i = 0; i < path.length - 1; i++) {
    const width = widths[i];
    const wCells = Math.max(1, Math.round(width / PIXEL));
    for (let j = 0; j < wCells; j++) {
      const u = wCells === 1 ? 0.5 : j / (wCells - 1);
      const rgb = lerpRgb(colorAt(u), WOOD_RGB, 0.5);
      const dx = (j - (wCells - 1) / 2) * PIXEL;
      drawPixelLine(
        ctx,
        { x: path[i].x + dx, y: path[i].y },
        { x: path[i + 1].x + dx, y: path[i + 1].y },
        PIXEL,
        rgbString(rgb),
      );
    }
  }
}

/**
 * The scene behind the tree, painted once per layout and cached: banded sky
 * with pixel clouds, a grass lip at the ground line (blades poking up), and
 * earth that darkens with depth, speckled and studded with shaded stones.
 * Deterministic, so it never flickers between redraws.
 */
function buildBackground(layout: TreeLayout, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const { bounds } = layout;
  ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(-bounds.minX), Math.round(-bounds.minY));

  const xFrom = cellOf(bounds.minX) - 1;
  const xTo = cellOf(bounds.maxX) + 1;
  const yFrom = cellOf(bounds.minY) - 1;
  const yTo = cellOf(bounds.maxY) + 1;
  const yGround = 0; // the trunk base sits on the ground line (world y = 0)

  const fill = (cx: number, cy: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(cx * PIXEL, cy * PIXEL, PIXEL, PIXEL);
  };

  // Texture fades out near the canvas edges, so the painted scene blends into
  // the flat CSS backdrop that continues beyond the canvas.
  const edgeFade = (cx: number, cy: number): number => {
    const d = Math.min(cx - xFrom, xTo - cx, cy - yFrom, yTo - cy);
    return Math.min(1, Math.max(0, d / 26));
  };

  // Sky: bands lightening toward the horizon, seams broken by dither noise.
  const skyRows = Math.max(1, yGround - yFrom);
  for (let cy = yFrom; cy < yGround; cy++) {
    const t = (cy - yFrom) / skyRows;
    for (let cx = xFrom; cx <= xTo; cx++) {
      const v = t * (SKY_BANDS.length - 1) + (cellNoise(cx, cy) - 0.5) * 0.6 * edgeFade(cx, cy);
      const idx = Math.min(SKY_BANDS.length - 1, Math.max(0, Math.round(v)));
      fill(cx, cy, SKY_BANDS[idx]);
    }
  }

  // Clouds: flat-bottomed puffs with a shaded underside, kept off the edges.
  const rng = mulberry32(20260707);
  const cloudCount = Math.max(6, Math.round(((xTo - xFrom) * skyRows) / 22000));
  for (let i = 0; i < cloudCount; i++) {
    const cx = xFrom + 22 + Math.floor(rng() * Math.max(1, xTo - xFrom - 44));
    const cy = yFrom + 10 + Math.floor(rng() * Math.max(1, skyRows * 0.72));
    const w = 14 + Math.floor(rng() * 24);
    const h = 4 + Math.floor(rng() * 4);
    const half = Math.floor(w / 2);
    for (let dx = -half; dx <= half; dx++) {
      const rel = dx / (half || 1);
      const lump = 0.7 + cellNoise(cx + dx, cy) * 0.5;
      const col = Math.max(1, Math.round(h * Math.sqrt(Math.max(0, 1 - rel * rel)) * lump));
      for (let k = 0; k < col; k++) {
        fill(cx + dx, cy - k, k === 0 ? CLOUD_SHADE : CLOUD_MAIN);
      }
    }
  }

  // Grass lip at the ground line, with blades poking into the sky.
  for (let cy = yGround; cy < yGround + GRASS_DEPTH_CELLS; cy++) {
    for (let cx = xFrom; cx <= xTo; cx++) {
      const fade = edgeFade(cx, cy);
      const n = cellNoise(cx, cy);
      const lastRow = cy === yGround + GRASS_DEPTH_CELLS - 1;
      const color =
        n < 0.2 * fade
          ? GRASS_SHADES[0]
          : n > 1 - 0.15 * fade
            ? GRASS_SHADES[1]
            : lastRow && n > 0.5 && fade === 1
              ? GRASS_SHADES[2]
              : GRASS_BASE;
      fill(cx, cy, color);
    }
  }
  for (let cx = xFrom; cx <= xTo; cx++) {
    if (cellNoise(cx, 911) < 0.22 * edgeFade(cx, yGround)) fill(cx, yGround - 1, GRASS_BASE);
  }

  // Earth: darkens with depth; soft speckles and pebbles break the monotony.
  const earthFrom = yGround + GRASS_DEPTH_CELLS;
  const earthRows = Math.max(1, yTo - earthFrom);
  for (let cy = earthFrom; cy <= yTo; cy++) {
    const t = (cy - earthFrom) / earthRows;
    for (let cx = xFrom; cx <= xTo; cx++) {
      const fade = edgeFade(cx, cy);
      const n = cellNoise(cx, cy);
      const v = t * (EARTH_BANDS.length - 1) + (n - 0.5) * 0.9 * fade;
      const idx = Math.min(EARTH_BANDS.length - 1, Math.max(0, Math.round(v)));
      let color = EARTH_BANDS[idx];
      // Speckles are just the neighbouring depth bands, so they stay subtle.
      if (n < 0.05 * fade) color = EARTH_BANDS[Math.min(EARTH_BANDS.length - 1, idx + 1)];
      else if (n > 1 - 0.05 * fade) color = EARTH_BANDS[Math.max(0, idx - 1)];
      fill(cx, cy, color);
    }
  }
  const stoneCount = Math.max(10, Math.round(((xTo - xFrom) * earthRows) / 3500));
  for (let i = 0; i < stoneCount; i++) {
    const sx = xFrom + 8 + Math.floor(rng() * Math.max(1, xTo - xFrom - 16));
    const sy = earthFrom + 3 + Math.floor(rng() * Math.max(1, earthRows - 8));
    const sw = 2 + Math.floor(rng() * 3);
    const sh = 1 + Math.floor(rng() * 2);
    for (let dx = 0; dx < sw; dx++) {
      for (let dy = 0; dy < sh; dy++) {
        // Clip the corners so wider pebbles read as rounded.
        if ((dx === 0 || dx === sw - 1) && (dy === 0 || dy === sh - 1) && sw > 2) continue;
        const color = dy === 0 && dx < sw - 1 ? STONE.light : dy === sh - 1 || dx === sw - 1 ? STONE.dark : STONE.mid;
        fill(sx + dx, sy + dy, color);
      }
    }
  }

  return canvas;
}

let backgroundCache: { layout: TreeLayout; canvas: HTMLCanvasElement } | null = null;

/**
 * CSS backdrop for the viewport around the canvas: the same sky/grass/earth
 * bands at the same screen heights as the painted scene (whose texture fades
 * out at the edges), so panning or zooming past the canvas shows the scene
 * continuing in flat color instead of a floating rectangle.
 */
export function sceneBackdropGradient(layout: TreeLayout, scale: number, ty: number): string {
  const { bounds } = layout;
  const canvasTop = ty;
  const horizon = (0 - bounds.minY) * scale + ty;
  const grassPx = GRASS_DEPTH_CELLS * PIXEL * scale;
  const earthTop = horizon + grassPx;
  const canvasBottom = (bounds.maxY - bounds.minY) * scale + ty;

  const stops: string[] = [`${SKY_BANDS[0]} 0px`];
  const skyH = Math.max(1, horizon - canvasTop);
  const nSky = SKY_BANDS.length;
  for (let k = 0; k < nSky; k++) {
    const from = canvasTop + (Math.max(0, k - 0.5) / (nSky - 1)) * skyH;
    const to = canvasTop + (Math.min(nSky - 1, k + 0.5) / (nSky - 1)) * skyH;
    stops.push(`${SKY_BANDS[k]} ${Math.round(from)}px`, `${SKY_BANDS[k]} ${Math.round(to)}px`);
  }
  stops.push(`${GRASS_BASE} ${Math.round(horizon)}px`, `${GRASS_BASE} ${Math.round(earthTop)}px`);
  const earthH = Math.max(1, canvasBottom - earthTop);
  const nEarth = EARTH_BANDS.length;
  for (let k = 0; k < nEarth; k++) {
    const from = earthTop + (Math.max(0, k - 0.5) / (nEarth - 1)) * earthH;
    const to = earthTop + (Math.min(nEarth - 1, k + 0.5) / (nEarth - 1)) * earthH;
    stops.push(`${EARTH_BANDS[k]} ${Math.round(from)}px`, `${EARTH_BANDS[k]} ${Math.round(to)}px`);
  }
  stops.push(`${EARTH_BANDS[nEarth - 1]} 100%`);
  return `linear-gradient(to bottom, ${stops.join(", ")})`;
}

export interface RenderOptions {
  progress: ProgressMap;
  highlightedId: string | null;
}

/** Average tint of the striped trunk — roots painted with it read as the same wood. */
function rootWoodColor(layout: TreeLayout): string {
  const n = layout.branches.length;
  if (n === 0) return COLORS.wood;
  const acc: Rgb = [0, 0, 0];
  for (const b of layout.branches) {
    const c = branchRgb(b.branchId);
    acc[0] += c[0];
    acc[1] += c[1];
    acc[2] += c[2];
  }
  const avg: Rgb = [Math.round(acc[0] / n), Math.round(acc[1] / n), Math.round(acc[2] / n)];
  return rgbString(lerpRgb(avg, WOOD_RGB, 0.5));
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

  if (!backgroundCache || backgroundCache.layout !== layout) {
    backgroundCache = { layout, canvas: buildBackground(layout, width, height) };
  }
  ctx.drawImage(backgroundCache.canvas, 0, 0);

  ctx.save();
  // Integer translation keeps the fat-pixel grid aligned to canvas pixels.
  ctx.translate(Math.round(-bounds.minX), Math.round(-bounds.minY));

  const rootColor = rootWoodColor(layout);
  for (const g of layout.groundRoots) {
    drawTaperedPath(ctx, g.path, g.baseWidth, g.tipWidth, rootColor);
  }

  for (const root of layout.roots) {
    drawTaperedPath(ctx, root.path, root.baseWidth, root.tipWidth, rootColor);
    drawAchievementFruit(ctx, root.leaf.center, root.status, options.highlightedId === root.customId);
  }

  drawTrunkStripes(ctx, layout);

  // Pass 1 — the whole crown as a background layer. A foliage cluster turns
  // green when a completed fruit is nearby (a fully completed branch greens
  // edge to edge). All cream clusters are painted first and all green ones
  // after, so a green patch stays solid instead of getting speckled by cream
  // neighbours drawn on top of it. Each group gets a drop-shadow pass first —
  // the overlapping shadows carve the dark clefts that make the canopy lumpy.
  const creamClusters: LeafCluster[] = [];
  const greenClusters: LeafCluster[] = [];
  // Proximity greening is checked against every completed fruit on the tree,
  // not just the cluster's own branch — neighbouring branches overlap, and a
  // green patch must have no cream stragglers from the branch next door.
  const allCompletedCenters: Point[] = [];
  for (const branch of layout.branches) {
    for (const twig of branch.twigs) {
      if (options.progress[twig.achievementId]) allCompletedCenters.push(twig.leaf.center);
    }
  }
  for (const branch of layout.branches) {
    const doneCount = branch.twigs.filter((t) => options.progress[t.achievementId]).length;
    const branchDone = branch.twigs.length > 0 && doneCount === branch.twigs.length;
    for (const leaf of branch.foliage) {
      // A fruit's own tuft greens with that fruit; filler clusters green when
      // any completed fruit is nearby (and always once the branch is done).
      const green = leaf.ownerId
        ? Boolean(options.progress[leaf.ownerId])
        : branchDone ||
          allCompletedCenters.some((c) => distSq(c, leaf.center) < GREEN_RADIUS * GREEN_RADIUS);
      (green ? greenClusters : creamClusters).push(leaf);
    }
  }
  for (const leaf of creamClusters) drawLeafShadow(ctx, leaf, FOLIAGE_CREAM.shadow);
  for (const leaf of creamClusters) drawLeafCluster(ctx, leaf, FOLIAGE_CREAM);
  for (const leaf of greenClusters) drawLeafShadow(ctx, leaf, FOLIAGE_GREEN.shadow);
  for (const leaf of greenClusters) drawLeafCluster(ctx, leaf, FOLIAGE_GREEN);

  // Pass 2 — branches and fruits on top, so all 14 directions and every
  // clickable fruit stay readable against the crown. Each branch is haloed
  // with dark wood first so it separates cleanly from the foliage behind it.
  for (const branch of layout.branches) {
    drawTaperedPath(
      ctx,
      branch.path,
      branch.baseWidth + PIXEL * 2,
      branch.tipWidth + PIXEL * 2,
      COLORS.branchUnderlay,
    );
    drawTaperedPath(ctx, branch.path, branch.baseWidth, branch.tipWidth, branchColor(branch.branchId));
    for (const twig of branch.twigs) {
      drawPixelLine(ctx, twig.stub[0], twig.stub[1], PIXEL, branchStubColor(branch.branchId));
    }
    for (const twig of branch.twigs) {
      const completed = Boolean(options.progress[twig.achievementId]);
      drawAchievementFruit(ctx, twig.leaf.center, completed, options.highlightedId === twig.achievementId);
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
