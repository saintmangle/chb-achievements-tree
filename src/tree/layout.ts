import type { Achievement, Branch, CustomAchievement } from "../types";
import { hashString, mulberry32 } from "./prng";
import type {
  BranchLayout,
  GroundRootLayout,
  LeafCluster,
  Point,
  RootLayout,
  TreeBounds,
  TreeLayout,
  TrunkLayout,
  TwigLayout,
} from "./types";

// The world is deliberately roomy relative to the 3-unit pixel grid — more
// spacing between elements means the fat pixels don't pile onto each other.
const TRUNK_HEIGHT = 360;
const TRUNK_SEGMENTS = 30;
const TRUNK_BASE_WIDTH = 33;
const TRUNK_TOP_WIDTH = 18;

// Branches attach along the trunk and fan out without crossing: on each side
// the lowest branch grows almost horizontally and every branch above it grows
// steeper, so each one stays inside its own angular sector.
const BRANCH_ATTACH_FROM = 0.3;
const BRANCH_ATTACH_TO = 0.96;
const BRANCH_ANGLE_FROM = (9 * Math.PI) / 180;
const BRANCH_ANGLE_TO = (76 * Math.PI) / 180;
const BRANCH_BASE_LENGTH = 60;
const BRANCH_LENGTH_PER_TWIG = 12;
const BRANCH_SEGMENT_LENGTH = 11;
const BRANCH_JITTER = 0.18;

// Chained ("сюжетные") achievements grow outward from their parent leaf,
// one step per link, so a requires-chain reads as one long twig.
const CHAIN_STEP = 24;
const CHAIN_FORK_SPREAD = 0.5;

// Decorative foliage keeps this distance from achievement "fruits" so the
// clickable spots stay visually clean.
const FOLIAGE_CLEARANCE = 17;

const ROOT_SEGMENT_LENGTH = 12;

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
    x += (rng() - 0.5) * 2 * (1 - t * 0.3);
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

/** Polyline that wanders gently around a fixed base direction — it can wiggle but never turns away from its sector. */
function buildWalkPath(
  start: Point,
  baseDir: number,
  segmentCount: number,
  segmentLength: number,
  seed: number,
  jitter: number,
): Point[] {
  const rng = mulberry32(seed);
  const path: Point[] = [start];
  let wander = 0;
  let cur = start;
  for (let i = 0; i < segmentCount; i++) {
    wander += (rng() - 0.5) * jitter;
    wander *= 0.9;
    const dir = baseDir + wander;
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

function blendAngle(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * k;
}

function buildLeafCluster(center: Point, seed: number): LeafCluster {
  const rng = mulberry32(seed);
  const blockCount = 7 + Math.floor(rng() * 5);
  const blocks: Point[] = [];
  for (let i = 0; i < blockCount; i++) {
    const angle = rng() * Math.PI * 2;
    const radius = rng() * 7.5;
    blocks.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    });
  }
  return { center, blocks, radius: 12 };
}

function buildBranch(
  branch: Branch,
  branchAchievements: Achievement[],
  attach: Point,
  dirAngle: number,
): BranchLayout {
  const seed = hashString(`branch:${branch.id}`);
  const count = branchAchievements.length;

  const ids = new Set(branchAchievements.map((a) => a.id));
  const childrenOf = new Map<string, Achievement[]>();
  const starts: Achievement[] = [];
  for (const a of branchAchievements) {
    if (a.requires && ids.has(a.requires)) {
      const list = childrenOf.get(a.requires) ?? [];
      list.push(a);
      childrenOf.set(a.requires, list);
    } else {
      starts.push(a);
    }
  }

  const targetLength = BRANCH_BASE_LENGTH + starts.length * BRANCH_LENGTH_PER_TWIG;
  const segmentCount = Math.max(5, Math.round(targetLength / BRANCH_SEGMENT_LENGTH));
  const path = buildWalkPath(attach, dirAngle, segmentCount, BRANCH_SEGMENT_LENGTH, seed, BRANCH_JITTER);

  const twigs: TwigLayout[] = [];

  const placeChain = (achievement: Achievement, from: Point, leafCenter: Point) => {
    twigs.push({
      achievementId: achievement.id,
      branchId: branch.id,
      title: achievement.title,
      description: achievement.description,
      stub: [from, leafCenter],
      leaf: buildLeafCluster(leafCenter, hashString(`leaf:${achievement.id}`)),
    });

    const children = childrenOf.get(achievement.id) ?? [];
    const stubAngle = Math.atan2(leafCenter.y - from.y, leafCenter.x - from.x);
    // Chains keep growing mostly along the branch's own direction so they
    // stay inside its sector and can't wander into a neighbouring branch.
    const baseAngle = blendAngle(stubAngle, dirAngle, 0.65);
    children.forEach((child, k) => {
      const spread = (k - (children.length - 1) / 2) * CHAIN_FORK_SPREAD;
      const jitter = (mulberry32(hashString(`chain:${child.id}`))() - 0.5) * 0.3;
      const angle = baseAngle + spread + jitter;
      const childLeaf: Point = {
        x: leafCenter.x + Math.cos(angle) * CHAIN_STEP,
        y: leafCenter.y + Math.sin(angle) * CHAIN_STEP,
      };
      placeChain(child, leafCenter, childLeaf);
    });
  };

  starts.forEach((achievement, i) => {
    const t = (i + 1) / (starts.length + 1);
    const { point, normal } = pointAtArcLength(path, t);
    const twigSide = i % 2 === 0 ? 1 : -1;
    const offset = 13 + (i % 3) * 4;
    const leafCenter: Point = {
      x: point.x + normal.x * offset * twigSide,
      y: point.y + normal.y * offset * twigSide,
    };
    placeChain(achievement, point, leafCenter);
  });

  // Lush decorative foliage: clusters along the outer 2/3 of the branch and a
  // cap of clusters past the tip.
  const foliage: LeafCluster[] = [];
  const frng = mulberry32(hashString(`foliage:${branch.id}`));
  const clusterCount = Math.max(10, Math.round(segmentCount * 2.4));
  for (let c = 0; c < clusterCount; c++) {
    const t = 0.22 + 0.78 * (c / Math.max(1, clusterCount - 1));
    const { point, normal } = pointAtArcLength(path, t);
    const side = c % 2 === 0 ? 1 : -1;
    const offset = 6 + frng() * 15;
    foliage.push(
      buildLeafCluster(
        { x: point.x + normal.x * offset * side, y: point.y + normal.y * offset * side },
        hashString(`fol:${branch.id}:${c}`),
      ),
    );
  }
  const tip = path[path.length - 1];
  for (let k = 0; k < 5; k++) {
    const a = dirAngle + (frng() - 0.5) * 1.1;
    const r = 10 + k * 9;
    foliage.push(
      buildLeafCluster(
        { x: tip.x + Math.cos(a) * r, y: tip.y + Math.sin(a) * r },
        hashString(`foltip:${branch.id}:${k}`),
      ),
    );
  }
  const clearedFoliage = foliage.filter((leaf) =>
    twigs.every((twig) => dist(leaf.center, twig.leaf.center) >= FOLIAGE_CLEARANCE),
  );

  return {
    branchId: branch.id,
    title: branch.title,
    path,
    baseWidth: 8 + Math.min(7, count * 0.2),
    tipWidth: 3,
    twigs,
    foliage: clearedFoliage,
  };
}

function buildRoot(custom: CustomAchievement, attach: Point, index: number): RootLayout {
  const seed = hashString(`root:${custom.id}`);
  // Fan the personal roots across the down hemisphere, one sector per root.
  const spread = ((index * 0.47) % 2) - 1;
  const dirAngle = Math.PI / 2 + spread * 1.0;
  const segmentCount = 6 + (hashString(`rootlen:${custom.id}`) % 3);
  const path = buildWalkPath(attach, dirAngle, segmentCount, ROOT_SEGMENT_LENGTH, seed, 0.25);
  const tip = path[path.length - 1];

  return {
    customId: custom.id,
    text: custom.text,
    status: custom.status,
    path,
    baseWidth: 6,
    tipWidth: 2.5,
    leaf: buildLeafCluster(tip, hashString(`rootleaf:${custom.id}`)),
  };
}

/** The tree always has a few bare roots, even before any custom achievements exist. */
function buildGroundRoots(base: Point): GroundRootLayout[] {
  const angles = [-0.8, -0.35, 0.2, 0.7];
  return angles.map((rel, i) => ({
    path: buildWalkPath(
      base,
      Math.PI / 2 + rel,
      7 + (i % 2),
      ROOT_SEGMENT_LENGTH,
      hashString(`groundroot:${i}`),
      0.25,
    ),
    baseWidth: 8,
    tipWidth: 2.5,
  }));
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

  const leftSide = fixedBranches.filter((_, i) => i % 2 === 0);
  const rightSide = fixedBranches.filter((_, i) => i % 2 === 1);

  const buildSide = (side: Branch[], isLeft: boolean): BranchLayout[] =>
    side.map((branch, k) => {
      const frac = side.length === 1 ? 0.5 : k / (side.length - 1);
      const jitter = (mulberry32(hashString(`attach:${branch.id}`))() - 0.5) * 0.03;
      const attachT = Math.min(
        1,
        Math.max(0, BRANCH_ATTACH_FROM + frac * (BRANCH_ATTACH_TO - BRANCH_ATTACH_FROM) + jitter),
      );
      const attach = trunkPointAt(trunk, attachT);
      const angle = BRANCH_ANGLE_FROM + frac * (BRANCH_ANGLE_TO - BRANCH_ANGLE_FROM);
      // Canvas y grows downward, so "up and outward" is negative sin.
      const dirAngle = isLeft ? Math.PI + angle : -angle;
      return buildBranch(branch, byBranch.get(branch.id) ?? [], attach, dirAngle);
    });

  // Order matters for the trunk stripes: left side first, then right —
  // the renderer paints stripes across the trunk in this order.
  const branchLayouts: BranchLayout[] = [...buildSide(leftSide, true), ...buildSide(rightSide, false)];

  const rootLayouts: RootLayout[] = customAchievements.map((custom, i) =>
    buildRoot(custom, trunk.path[0], i),
  );
  const groundRoots = buildGroundRoots(trunk.path[0]);

  const bounds: TreeBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  for (const p of trunk.path) expandBounds(bounds, p, TRUNK_BASE_WIDTH);
  for (const b of branchLayouts) {
    for (const p of b.path) expandBounds(bounds, p, b.baseWidth);
    for (const twig of b.twigs) expandBounds(bounds, twig.leaf.center, twig.leaf.radius + 8);
    for (const leaf of b.foliage) expandBounds(bounds, leaf.center, leaf.radius + 8);
  }
  for (const r of rootLayouts) {
    for (const p of r.path) expandBounds(bounds, p, r.baseWidth);
    expandBounds(bounds, r.leaf.center, r.leaf.radius + 8);
  }
  for (const g of groundRoots) {
    for (const p of g.path) expandBounds(bounds, p, g.baseWidth);
  }
  const margin = 30;
  bounds.minX -= margin;
  bounds.maxX += margin;
  bounds.minY -= margin;
  bounds.maxY += margin;

  return { trunk, branches: branchLayouts, roots: rootLayouts, groundRoots, bounds };
}
