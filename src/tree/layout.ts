import type { Achievement, Branch, CustomAchievement } from "../types";
import { hashString, mulberry32 } from "./prng";
import type {
  BranchLayout,
  LeafCluster,
  Point,
  RootLayout,
  TreeBounds,
  TreeLayout,
  TrunkLayout,
  TwigLayout,
} from "./types";

const TRUNK_HEIGHT = 260;
const TRUNK_SEGMENTS = 26;
const TRUNK_BASE_WIDTH = 16;
const TRUNK_TOP_WIDTH = 6;

const BRANCH_ATTACH_FROM = 0.24;
const BRANCH_ATTACH_TO = 0.97;
const BRANCH_BASE_LENGTH = 34;
const BRANCH_LENGTH_PER_TWIG = 8.5;
const BRANCH_SEGMENT_LENGTH = 9;

const ROOT_SEGMENT_LENGTH = 9;

function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function buildTrunk(): TrunkLayout {
  const rng = mulberry32(1337);
  const path: Point[] = [];
  const widths: number[] = [];
  let x = 0;
  for (let i = 0; i <= TRUNK_SEGMENTS; i++) {
    const t = i / TRUNK_SEGMENTS;
    x += (rng() - 0.5) * 3 * (1 - t * 0.3);
    x *= 0.9;
    path.push({ x, y: -t * TRUNK_HEIGHT });
    widths.push(TRUNK_BASE_WIDTH + (TRUNK_TOP_WIDTH - TRUNK_BASE_WIDTH) * t);
  }
  return { path, widths };
}

function trunkPointAt(trunk: TrunkLayout, t: number): Point {
  const idx = Math.round(t * TRUNK_SEGMENTS);
  return trunk.path[Math.min(trunk.path.length - 1, Math.max(0, idx))];
}

/** Random-walk polyline: outward + slightly biased vertically, deterministic per seed. */
function buildWalkPath(
  start: Point,
  side: 1 | -1,
  segmentCount: number,
  segmentLength: number,
  verticalBias: number,
  seed: number,
): Point[] {
  const rng = mulberry32(seed);
  const path: Point[] = [start];
  let dir = side === 1 ? -0.3 : Math.PI + 0.3;
  let cur = start;
  for (let i = 0; i < segmentCount; i++) {
    dir += (rng() - 0.5) * 0.55 + verticalBias * side * 0 + verticalBias;
    const next: Point = {
      x: cur.x + Math.cos(dir) * segmentLength,
      y: cur.y + Math.sin(dir) * segmentLength,
    };
    path.push(next);
    cur = next;
  }
  return path;
}

/** Interpolate a point + outward normal at arc-length fraction t (0..1) along a polyline. */
function pointAtArcLength(path: Point[], t: number): { point: Point; normal: Point } {
  const lengths = [0];
  for (let i = 1; i < path.length; i++) {
    lengths.push(lengths[i - 1] + dist(path[i - 1], path[i]));
  }
  const total = lengths[lengths.length - 1] || 1;
  const target = Math.min(total, Math.max(0, t * total));

  let segIdx = 0;
  while (segIdx < lengths.length - 2 && lengths[segIdx + 1] < target) segIdx++;

  const segStart = path[segIdx];
  const segEnd = path[segIdx + 1] ?? segStart;
  const segLen = lengths[segIdx + 1] - lengths[segIdx] || 1;
  const localT = (target - lengths[segIdx]) / segLen;

  const point: Point = {
    x: segStart.x + (segEnd.x - segStart.x) * localT,
    y: segStart.y + (segEnd.y - segStart.y) * localT,
  };
  const dx = segEnd.x - segStart.x;
  const dy = segEnd.y - segStart.y;
  const len = Math.hypot(dx, dy) || 1;
  const normal: Point = { x: -dy / len, y: dx / len };
  return { point, normal };
}

function buildLeafCluster(center: Point, seed: number): LeafCluster {
  const rng = mulberry32(seed);
  const blockCount = 4 + Math.floor(rng() * 3);
  const blocks: Point[] = [];
  for (let i = 0; i < blockCount; i++) {
    const angle = rng() * Math.PI * 2;
    const radius = rng() * 4.5;
    blocks.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    });
  }
  return { center, blocks, radius: 7 };
}

function buildBranch(
  branch: Branch,
  branchAchievements: Achievement[],
  attach: Point,
  side: 1 | -1,
): BranchLayout {
  const seed = hashString(`branch:${branch.id}`);
  const count = branchAchievements.length;
  const targetLength = BRANCH_BASE_LENGTH + count * BRANCH_LENGTH_PER_TWIG;
  const segmentCount = Math.max(4, Math.round(targetLength / BRANCH_SEGMENT_LENGTH));
  const path = buildWalkPath(attach, side, segmentCount, BRANCH_SEGMENT_LENGTH, -0.09, seed);

  const twigs: TwigLayout[] = branchAchievements.map((achievement, i) => {
    const t = (i + 1) / (count + 1);
    const { point, normal } = pointAtArcLength(path, t);
    const twigSide = i % 2 === 0 ? 1 : -1;
    const offset = 9 + (i % 3) * 2.5;
    const leafCenter: Point = {
      x: point.x + normal.x * offset * twigSide,
      y: point.y + normal.y * offset * twigSide,
    };
    return {
      achievementId: achievement.id,
      branchId: branch.id,
      title: achievement.title,
      description: achievement.description,
      stub: [point, leafCenter],
      leaf: buildLeafCluster(leafCenter, hashString(`leaf:${achievement.id}`)),
    };
  });

  return {
    branchId: branch.id,
    title: branch.title,
    path,
    baseWidth: 4 + Math.min(6, count * 0.18),
    tipWidth: 1.5,
    twigs,
  };
}

function buildRoot(custom: CustomAchievement, attach: Point, side: 1 | -1, index: number): RootLayout {
  const seed = hashString(`root:${custom.id}`);
  const segmentCount = 4 + (hashString(`rootlen:${custom.id}`) % 3);
  const jitteredAttach: Point = { x: attach.x + side * (index % 4) * 1.5, y: attach.y };
  const path = buildWalkPath(jitteredAttach, side, segmentCount, ROOT_SEGMENT_LENGTH, 0.1, seed);
  const tip = path[path.length - 1];

  return {
    customId: custom.id,
    text: custom.text,
    status: custom.status,
    path,
    baseWidth: 4,
    tipWidth: 1.5,
    leaf: buildLeafCluster(tip, hashString(`rootleaf:${custom.id}`)),
  };
}

function expandBounds(bounds: TreeBounds, p: Point, pad = 0) {
  bounds.minX = Math.min(bounds.minX, p.x - pad);
  bounds.maxX = Math.max(bounds.maxX, p.x + pad);
  bounds.minY = Math.min(bounds.minY, p.y - pad);
  bounds.maxY = Math.max(bounds.maxY, p.y + pad);
}

export function buildTreeLayout(
  branches: Branch[],
  achievements: Achievement[],
  customAchievements: CustomAchievement[],
): TreeLayout {
  const trunk = buildTrunk();

  const byBranch = new Map<number, Achievement[]>();
  for (const a of achievements) {
    const list = byBranch.get(a.branch_id) ?? [];
    list.push(a);
    byBranch.set(a.branch_id, list);
  }
  for (const list of byBranch.values()) list.sort((a, b) => a.order - b.order);

  // Branch 15 ("сделай сам") has no fixed achievements — it's represented by
  // the roots below, not as a regular branch.
  const fixedBranches = branches.filter((b) => (byBranch.get(b.id)?.length ?? 0) > 0);

  const branchLayouts: BranchLayout[] = fixedBranches.map((branch, i) => {
    const t =
      fixedBranches.length === 1
        ? (BRANCH_ATTACH_FROM + BRANCH_ATTACH_TO) / 2
        : BRANCH_ATTACH_FROM + (i / (fixedBranches.length - 1)) * (BRANCH_ATTACH_TO - BRANCH_ATTACH_FROM);
    const jitter = (mulberry32(hashString(`attach:${branch.id}`))() - 0.5) * 0.04;
    const attach = trunkPointAt(trunk, Math.min(1, Math.max(0, t + jitter)));
    const side: 1 | -1 = i % 2 === 0 ? 1 : -1;
    return buildBranch(branch, byBranch.get(branch.id) ?? [], attach, side);
  });

  const rootLayouts: RootLayout[] = customAchievements.map((custom, i) => {
    const side: 1 | -1 = i % 2 === 0 ? 1 : -1;
    return buildRoot(custom, trunk.path[0], side, i);
  });

  const bounds: TreeBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  for (const p of trunk.path) expandBounds(bounds, p, TRUNK_BASE_WIDTH);
  for (const b of branchLayouts) {
    for (const p of b.path) expandBounds(bounds, p, b.baseWidth);
    for (const twig of b.twigs) {
      expandBounds(bounds, twig.leaf.center, twig.leaf.radius + 6);
    }
  }
  for (const r of rootLayouts) {
    for (const p of r.path) expandBounds(bounds, p, r.baseWidth);
    expandBounds(bounds, r.leaf.center, r.leaf.radius + 6);
  }
  const margin = 24;
  bounds.minX -= margin;
  bounds.maxX += margin;
  bounds.minY -= margin;
  bounds.maxY += margin;

  return { trunk, branches: branchLayouts, roots: rootLayouts, bounds };
}
