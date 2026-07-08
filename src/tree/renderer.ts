import type { ProgressMap } from "../types";
import { mulberry32 } from "./prng";
import type { LeafCluster, Point, TreeLayout } from "./types";

// Everything is rasterized onto a fixed square grid of PIXEL×PIXEL world
// units — axis-aligned, uniform-size "fat pixels", like squares on grid paper.
const PIXEL = 3;

const COLORS = {
  wood: "#4a3222",
  // One dark outline around the whole wood silhouette (roots, trunk, branches).
  woodOutline: "#2b1c10",
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

// Background palette. Sky and earth are fine-grained ramps (many close steps
// instead of a few coarse bands), so the in-canvas dithered gradient and the
// smooth CSS backdrop around it look like one continuous surface.
const SKY_KEYS = ["#2f6bab", "#4f8ec7", "#9ccbe9"];
const EARTH_KEYS = ["#8a5526", "#653a1a", "#3f240f"];
const CLOUD_MAIN = "#f4f9fc";
const CLOUD_SHADE = "#c9dcea";
const GRASS_BASE = "#5ea23f";
const GRASS_SHADES = ["#4c8f33", "#71b34c", "#3f7a2a"];
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

function hexRgb(hex: string): Rgb {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** Evenly-spaced color steps along a piecewise-linear ramp through the keys. */
function rampBands(keys: string[], steps: number): Rgb[] {
  const rgbKeys = keys.map(hexRgb);
  const bands: Rgb[] = [];
  for (let i = 0; i < steps; i++) {
    const pos = (i / (steps - 1)) * (rgbKeys.length - 1);
    const k = Math.min(rgbKeys.length - 2, Math.floor(pos));
    bands.push(lerpRgb(rgbKeys[k], rgbKeys[k + 1], pos - k));
  }
  return bands;
}

const SKY_BANDS = rampBands(SKY_KEYS, 18);
const EARTH_BANDS = rampBands(EARTH_KEYS, 12);
const GRASS_BASE_RGB = hexRgb(GRASS_BASE);
const GRASS_SHADES_RGB = GRASS_SHADES.map(hexRgb);

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
  return rgbString(lerpRgb(branchRgb(branchId), [220, 210, 190], 0.3));
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

interface CachedLayer {
  canvas: HTMLCanvasElement;
  /** Where to draw the layer on the main canvas (identity coordinates). */
  dx: number;
  dy: number;
}

/**
 * The scene behind the tree, painted once per layout and cached: a dithered
 * sky with pixel clouds, a grass lip at the ground line (blades poking up),
 * and earth that darkens with depth, speckled and studded with shaded stones.
 * Built at ONE CANVAS PIXEL PER WORLD CELL straight into an ImageData buffer
 * (the apron around the tree is huge), then upscaled ×PIXEL with smoothing
 * off, which keeps the fat-pixel grid exact. Deterministic, so it never
 * flickers between redraws.
 */
function buildBackground(layout: TreeLayout): CachedLayer {
  const { bounds } = layout;
  const xFrom = cellOf(bounds.minX) - 1;
  const xTo = cellOf(bounds.maxX) + 1;
  const yFrom = cellOf(bounds.minY) - 1;
  const yTo = cellOf(bounds.maxY) + 1;
  const wCells = xTo - xFrom + 1;
  const hCells = yTo - yFrom + 1;
  const yGround = 0; // the trunk base sits on the ground line (world y = 0)

  const canvas = document.createElement("canvas");
  canvas.width = wCells;
  canvas.height = hCells;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(wCells, hCells);
  const px = img.data;

  // Texture fades out near the scene edges, blending into the flat CSS
  // backdrop that continues beyond the canvas.
  const edgeFade = (cx: number, cy: number): number => {
    const d = Math.min(cx - xFrom, xTo - cx, cy - yFrom, yTo - cy);
    return Math.min(1, Math.max(0, d / 26));
  };

  const skyRows = Math.max(1, yGround - yFrom);
  const earthFrom = yGround + GRASS_DEPTH_CELLS;
  const earthRows = Math.max(1, yTo - earthFrom);

  for (let cy = yFrom; cy <= yTo; cy++) {
    for (let cx = xFrom; cx <= xTo; cx++) {
      const fade = edgeFade(cx, cy);
      const n = cellNoise(cx, cy);
      let rgb: Rgb;
      if (cy < yGround) {
        // Sky: fine bands lightening toward the horizon, dither-blended.
        const t = (cy - yFrom) / skyRows;
        const v = t * (SKY_BANDS.length - 1) + (n - 0.5) * 1.2 * fade;
        rgb = SKY_BANDS[Math.min(SKY_BANDS.length - 1, Math.max(0, Math.round(v)))];
      } else if (cy < earthFrom) {
        // Grass lip at the ground line.
        const lastRow = cy === earthFrom - 1;
        rgb =
          n < 0.2 * fade
            ? GRASS_SHADES_RGB[0]
            : n > 1 - 0.15 * fade
              ? GRASS_SHADES_RGB[1]
              : lastRow && n > 0.5 && fade === 1
                ? GRASS_SHADES_RGB[2]
                : GRASS_BASE_RGB;
      } else {
        // Earth: darkens with depth; speckles are nearby depth bands.
        const t = (cy - earthFrom) / earthRows;
        const v = t * (EARTH_BANDS.length - 1) + (n - 0.5) * 1.6 * fade;
        let idx = Math.min(EARTH_BANDS.length - 1, Math.max(0, Math.round(v)));
        if (n < 0.05 * fade) idx = Math.min(EARTH_BANDS.length - 1, idx + 3);
        else if (n > 1 - 0.05 * fade) idx = Math.max(0, idx - 3);
        rgb = EARTH_BANDS[idx];
      }
      const o = ((cy - yFrom) * wCells + (cx - xFrom)) * 4;
      px[o] = rgb[0];
      px[o + 1] = rgb[1];
      px[o + 2] = rgb[2];
      px[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Decorations, still at one pixel per cell.
  const dot = (cx: number, cy: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(cx - xFrom, cy - yFrom, 1, 1);
  };

  // Grass blades poking into the sky.
  for (let cx = xFrom; cx <= xTo; cx++) {
    if (cellNoise(cx, 911) < 0.22 * edgeFade(cx, yGround)) dot(cx, yGround - 1, GRASS_BASE);
  }

  // Clouds: flat-bottomed puffs with a shaded underside, all over the sky.
  const rng = mulberry32(20260707);
  const cloudCount = Math.max(8, Math.round((wCells * skyRows) / 16000));
  for (let i = 0; i < cloudCount; i++) {
    const cx = xFrom + 22 + Math.floor(rng() * Math.max(1, wCells - 44));
    const cy = yFrom + 10 + Math.floor(rng() * Math.max(1, skyRows * 0.8));
    const w = 14 + Math.floor(rng() * 24);
    const h = 4 + Math.floor(rng() * 4);
    const half = Math.floor(w / 2);
    for (let dx = -half; dx <= half; dx++) {
      const rel = dx / (half || 1);
      const lump = 0.7 + cellNoise(cx + dx, cy) * 0.5;
      const col = Math.max(1, Math.round(h * Math.sqrt(Math.max(0, 1 - rel * rel)) * lump));
      for (let k = 0; k < col; k++) {
        dot(cx + dx, cy - k, k === 0 ? CLOUD_SHADE : CLOUD_MAIN);
      }
    }
  }

  // Stones scattered through the earth.
  const stoneCount = Math.max(12, Math.round((wCells * earthRows) / 3500));
  for (let i = 0; i < stoneCount; i++) {
    const sx = xFrom + 8 + Math.floor(rng() * Math.max(1, wCells - 16));
    const sy = earthFrom + 3 + Math.floor(rng() * Math.max(1, earthRows - 8));
    const sw = 2 + Math.floor(rng() * 3);
    const sh = 1 + Math.floor(rng() * 2);
    for (let dx = 0; dx < sw; dx++) {
      for (let dy = 0; dy < sh; dy++) {
        // Clip the corners so wider pebbles read as rounded.
        if ((dx === 0 || dx === sw - 1) && (dy === 0 || dy === sh - 1) && sw > 2) continue;
        const color = dy === 0 && dx < sw - 1 ? STONE.light : dy === sh - 1 || dx === sw - 1 ? STONE.dark : STONE.mid;
        dot(sx + dx, sy + dy, color);
      }
    }
  }

  return {
    canvas,
    dx: xFrom * PIXEL + Math.round(-bounds.minX),
    dy: yFrom * PIXEL + Math.round(-bounds.minY),
  };
}

let backgroundCache: { layout: TreeLayout; layer: CachedLayer } | null = null;

/**
 * Solid silhouette of all the wood — roots, trunk, branches — in the outline
 * color. Stamped around the tree as eight one-cell offsets, it draws a single
 * unbroken outline around the whole figure, so no branch outline ever crosses
 * the trunk and the tree reads as one piece.
 */
function buildWoodMask(layout: TreeLayout): CachedLayer {
  // Sized to the tree itself, not the huge scenery apron around it.
  const tb = layout.treeBounds;
  const pad = PIXEL * 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(tb.maxX - tb.minX) + pad * 2;
  canvas.height = Math.ceil(tb.maxY - tb.minY) + pad * 2;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(-tb.minX) + pad, Math.round(-tb.minY) + pad);
  const color = COLORS.woodOutline;
  for (const g of layout.groundRoots) drawTaperedPath(ctx, g.path, g.baseWidth, g.tipWidth, color);
  for (const f of layout.crownForks) drawTaperedPath(ctx, f.path, f.baseWidth, f.tipWidth, color);
  for (const r of layout.roots) drawTaperedPath(ctx, r.path, r.baseWidth, r.tipWidth, color);
  const { trunk } = layout;
  for (let i = 0; i < trunk.path.length - 1; i++) {
    drawPixelLine(ctx, trunk.path[i], trunk.path[i + 1], trunk.widths[i], color);
  }
  for (const b of layout.branches) drawTaperedPath(ctx, b.path, b.baseWidth, b.tipWidth, color);
  return {
    canvas,
    dx: Math.round(-layout.bounds.minX) - (Math.round(-tb.minX) + pad),
    dy: Math.round(-layout.bounds.minY) - (Math.round(-tb.minY) + pad),
  };
}

let woodMaskCache: { layout: TreeLayout; layer: CachedLayer } | null = null;

const OUTLINE_OFFSETS: Array<[number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

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

  // Smooth gradients through the same key colors the canvas ramps interpolate,
  // pinned to the same screen heights — the two surfaces read as one.
  const stops: string[] = [`${SKY_KEYS[0]} 0px`];
  const skyH = Math.max(1, horizon - canvasTop);
  SKY_KEYS.forEach((key, k) => {
    stops.push(`${key} ${Math.round(canvasTop + (k / (SKY_KEYS.length - 1)) * skyH)}px`);
  });
  stops.push(`${GRASS_BASE} ${Math.round(horizon)}px`, `${GRASS_BASE} ${Math.round(earthTop)}px`);
  const earthH = Math.max(1, canvasBottom - earthTop);
  EARTH_KEYS.forEach((key, k) => {
    stops.push(`${key} ${Math.round(earthTop + (k / (EARTH_KEYS.length - 1)) * earthH)}px`);
  });
  stops.push(`${EARTH_KEYS[EARTH_KEYS.length - 1]} 100%`);
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
    backgroundCache = { layout, layer: buildBackground(layout) };
  }
  const bg = backgroundCache.layer;
  // The cell-resolution scene upscales ×PIXEL; smoothing is off, so each of
  // its pixels lands as one crisp fat pixel.
  ctx.drawImage(bg.canvas, bg.dx, bg.dy, bg.canvas.width * PIXEL, bg.canvas.height * PIXEL);

  if (!woodMaskCache || woodMaskCache.layout !== layout) {
    woodMaskCache = { layout, layer: buildWoodMask(layout) };
  }

  ctx.save();
  // Integer translation keeps the fat-pixel grid aligned to canvas pixels.
  ctx.translate(Math.round(-bounds.minX), Math.round(-bounds.minY));

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

  ctx.restore();

  // Pass 2 — one outline around the entire wood figure, then the wood itself
  // on top of the crown, so the tree reads as a single solid piece and every
  // branch stays readable against the foliage.
  const mask = woodMaskCache.layer;
  for (const [dx, dy] of OUTLINE_OFFSETS) {
    ctx.drawImage(mask.canvas, mask.dx + dx * PIXEL, mask.dy + dy * PIXEL);
  }

  ctx.save();
  ctx.translate(Math.round(-bounds.minX), Math.round(-bounds.minY));

  const rootColor = rootWoodColor(layout);
  for (const g of layout.groundRoots) {
    drawTaperedPath(ctx, g.path, g.baseWidth, g.tipWidth, rootColor);
  }
  for (const f of layout.crownForks) {
    drawTaperedPath(ctx, f.path, f.baseWidth, f.tipWidth, rootColor);
  }
  for (const root of layout.roots) {
    drawTaperedPath(ctx, root.path, root.baseWidth, root.tipWidth, rootColor);
  }
  drawTrunkStripes(ctx, layout);
  for (const branch of layout.branches) {
    drawTaperedPath(ctx, branch.path, branch.baseWidth, branch.tipWidth, branchColor(branch.branchId));
  }

  // Pass 3 — connectors and clickable fruits on the very top. Connectors are
  // two cells thick so it's easy to trace which fruit hangs off which branch.
  for (const branch of layout.branches) {
    for (const twig of branch.twigs) {
      drawPixelLine(ctx, twig.stub[0], twig.stub[1], PIXEL * 2, branchStubColor(branch.branchId));
    }
    for (const twig of branch.twigs) {
      const completed = Boolean(options.progress[twig.achievementId]);
      drawAchievementFruit(ctx, twig.leaf.center, completed, options.highlightedId === twig.achievementId);
    }
  }
  for (const root of layout.roots) {
    drawAchievementFruit(ctx, root.leaf.center, root.status, options.highlightedId === root.customId);
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
