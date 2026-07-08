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
const TRUNK_HEIGHT = 520;
const TRUNK_SEGMENTS = 40;
const TRUNK_BASE_WIDTH = 58;
const TRUNK_TOP_WIDTH = 34;
// The trunk flares toward the ground like the reference art.
const TRUNK_FLARE = 1.35;
// Above the last branch the trunk keeps going as a thin tapering leader —
// without it the top ends in a flat stump.
const TRUNK_TIP_HEIGHT = 70;
const TRUNK_TIP_WIDTH = 6;

// Branches attach along the trunk and fan out without crossing: on each side
// the lowest branch grows almost horizontally and every branch above it grows
// steeper, so each one stays inside its own angular sector. The steepest
// branch stays under ~55° — near-vertical branches from the two sides used to
// bunch into a parallel broom at the crown top.
const BRANCH_ATTACH_FROM = 0.38;
const BRANCH_ATTACH_TO = 0.97;
const BRANCH_ANGLE_FROM = (9 * Math.PI) / 180;
const BRANCH_ANGLE_TO = (55 * Math.PI) / 180;
const BRANCH_BASE_LENGTH = 90;
const BRANCH_LENGTH_PER_TWIG = 16;
const BRANCH_SEGMENT_LENGTH = 13;
const BRANCH_JITTER = 0.1;
// Branches arc upward as they grow (0 = straight, 1 = fully turned up by the
// tip). The SAME curl fraction for every branch is what guarantees they never
// cross: each branch's direction stays a fixed blend between its own start
// angle and vertical, so if branch A starts below branch B it also ends below
// it — the angular lanes never converge. (Scaling curl per branch broke this
// and made mid-crown branches meet.)
const BRANCH_CURL = 0.35;
// The first stretch of every limb is bare wood, like on a real tree — leaves
// and fruits only start past this fraction of the branch length.
const BRANCH_BARE_FRACTION = 0.3;

// Chained ("сюжетные") achievements grow outward from their parent leaf,
// one step per link, so a requires-chain reads as one long twig.
const CHAIN_STEP = 36;
const CHAIN_FORK_SPREAD = 0.9;

// Fruits are pushed apart until no two are closer than this (fruit is ~15
// world units across, so this guarantees a clear gap of several pixels).
const MIN_FRUIT_DIST = 36;

// Decorative foliage keeps this distance from achievement "fruits" so the
// clickable spots stay visually clean.
const FOLIAGE_CLEARANCE = 18;

// No foliage this close to the trunk centerline — the trunk rises cleanly
// through the crown, with leaves starting out on the limbs.
const TRUNK_FOLIAGE_CLEARANCE = 64;

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
    const flare = 1 + (TRUNK_FLARE - 1) * Math.max(0, 1 - t / 0.14);
    widths.push((TRUNK_BASE_WIDTH + (TRUNK_TOP_WIDTH - TRUNK_BASE_WIDTH) * t) * flare);
  }
  // The tapering leader on top; crown foliage is allowed to close over it.
  const tipSegments = 6;
  for (let i = 1; i <= tipSegments; i++) {
    const t = i / tipSegments;
    x += (rng() - 0.5) * 2;
    x *= 0.9;
    path.push({ x, y: -(TRUNK_HEIGHT + t * TRUNK_TIP_HEIGHT) });
    widths.push(TRUNK_TOP_WIDTH + (TRUNK_TIP_WIDTH - TRUNK_TOP_WIDTH) * t);
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
  curlToward = baseDir,
  curl = 0,
): Point[] {
  const rng = mulberry32(seed);
  const path: Point[] = [start];
  let wander = 0;
  let cur = start;
  for (let i = 0; i < segmentCount; i++) {
    const t = segmentCount > 1 ? i / (segmentCount - 1) : 0;
    wander += (rng() - 0.5) * jitter;
    wander *= 0.9;
    const dir = blendAngle(baseDir, curlToward, t * curl) + wander;
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

// Must match the renderer's PIXEL so cluster blocks sit on the same grid.
const LEAF_BLOCK = 3;

/** Big rounded blob with slightly ragged edges — overlapping blobs merge into a full canopy. */
function buildLeafCluster(center: Point, seed: number): LeafCluster {
  const rng = mulberry32(seed);
  const radiusCells = 5 + Math.floor(rng() * 3);
  const blocks: Point[] = [];
  for (let dx = -radiusCells; dx <= radiusCells; dx++) {
    for (let dy = -radiusCells; dy <= radiusCells; dy++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > radiusCells * radiusCells + 0.5) continue;
      // Full core, slightly ragged rim (too ragged reads as static noise).
      if (d2 > (radiusCells - 1) * (radiusCells - 1) && rng() < 0.3) continue;
      blocks.push({ x: center.x + dx * LEAF_BLOCK, y: center.y + dy * LEAF_BLOCK });
    }
  }
  return { center, blocks, radius: 16 };
}

function buildBranch(
  branch: Branch,
  branchAchievements: Achievement[],
  attach: Point,
  dirAngle: number,
  curl: number,
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
  const path = buildWalkPath(
    attach,
    dirAngle,
    segmentCount,
    BRANCH_SEGMENT_LENGTH,
    seed,
    BRANCH_JITTER,
    -Math.PI / 2,
    curl,
  );

  const twigs: TwigLayout[] = [];

  const placeChain = (achievement: Achievement, from: Point, leafCenter: Point, parentId?: string) => {
    twigs.push({
      achievementId: achievement.id,
      branchId: branch.id,
      title: achievement.title,
      description: achievement.description,
      stub: [from, leafCenter],
      leaf: buildLeafCluster(leafCenter, hashString(`leaf:${achievement.id}`)),
      parentAchievementId: parentId,
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
      placeChain(child, leafCenter, childLeaf, achievement.id);
    });
  };

  starts.forEach((achievement, i) => {
    // Fruits start away from the trunk — the first stretch of a real limb
    // is bare wood.
    const t = BRANCH_BARE_FRACTION + (1 - BRANCH_BARE_FRACTION) * ((i + 1) / (starts.length + 1));
    const { point, normal } = pointAtArcLength(path, t);
    const twigSide = i % 2 === 0 ? 1 : -1;
    const offset = 18 + (i % 3) * 5;
    const leafCenter: Point = {
      x: point.x + normal.x * offset * twigSide,
      y: point.y + normal.y * offset * twigSide,
    };
    placeChain(achievement, point, leafCenter);
  });

  // Dense crown: lots of clusters on both sides of the branch at varying
  // distances plus a thick cap past the tip. Drawn as a background layer —
  // branches and fruits are painted on top of it. (Fruit clearance is applied
  // later, once the fruits have settled into their final positions.)
  const foliage: LeafCluster[] = [];
  const frng = mulberry32(hashString(`foliage:${branch.id}`));
  const clusterCount = Math.max(32, Math.round(segmentCount * 5));
  for (let c = 0; c < clusterCount; c++) {
    const t = BRANCH_BARE_FRACTION + (1 - BRANCH_BARE_FRACTION) * (c / Math.max(1, clusterCount - 1));
    const { point, normal } = pointAtArcLength(path, t);
    const side = c % 2 === 0 ? 1 : -1;
    const offset = 8 + frng() * 30;
    foliage.push(
      buildLeafCluster(
        { x: point.x + normal.x * offset * side, y: point.y + normal.y * offset * side },
        hashString(`fol:${branch.id}:${c}`),
      ),
    );
  }
  const tip = path[path.length - 1];
  for (let k = 0; k < 10; k++) {
    const a = dirAngle + (frng() - 0.5) * 1.4;
    const r = 10 + k * 9;
    foliage.push(
      buildLeafCluster(
        { x: tip.x + Math.cos(a) * r, y: tip.y + Math.sin(a) * r },
        hashString(`foltip:${branch.id}:${k}`),
      ),
    );
  }

  return {
    branchId: branch.id,
    title: branch.title,
    path,
    baseWidth: 12 + Math.min(10, count * 0.35),
    tipWidth: 4,
    twigs,
    foliage,
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

/**
 * The trunk continues underground as a short root collar that immediately
 * splits into a wide fan of main roots — the crown mirrored underground, like
 * the reference art. Main roots dive as they spread and fork once into
 * thinner side roots. Custom-achievement roots also grow from the fork point.
 */
function buildGroundRoots(base: Point): { layouts: GroundRootLayout[]; fork: Point } {
  const taproot: Point[] = [
    { x: base.x, y: base.y },
    { x: base.x + 1.5, y: base.y + 16 },
    { x: base.x - 1, y: base.y + 32 },
  ];
  const fork = taproot[taproot.length - 1];
  const layouts: GroundRootLayout[] = [
    { path: taproot, baseWidth: TRUNK_BASE_WIDTH * TRUNK_FLARE, tipWidth: TRUNK_BASE_WIDTH },
  ];
  const angles = [-1.3, -0.85, -0.4, 0.05, 0.45, 0.9, 1.3];
  angles.forEach((rel, i) => {
    const main = buildWalkPath(
      fork,
      Math.PI / 2 + rel,
      8 + (i % 4),
      ROOT_SEGMENT_LENGTH + 2,
      hashString(`groundroot:${i}`),
      0.3,
      Math.PI / 2,
      0.4,
    );
    layouts.push({ path: main, baseWidth: 15, tipWidth: 3 });
    // One fork per main root: a thinner side root splitting off midway.
    const mid = main[Math.floor(main.length * 0.5)];
    layouts.push({
      path: buildWalkPath(
        mid,
        Math.PI / 2 + rel + (i % 2 === 0 ? 0.6 : -0.6),
        5 + (i % 2),
        ROOT_SEGMENT_LENGTH,
        hashString(`groundfork:${i}`),
        0.3,
      ),
      baseWidth: 8,
      tipWidth: 2.5,
    });
  });
  return { layouts, fork };
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

  // Place big branches low (near-horizontal sectors have the most room) and
  // small ones high. Only the position changes — ids/numbers stay the same.
  const weightOf = (b: Branch): number => {
    const achs = byBranch.get(b.id) ?? [];
    const ids = new Set(achs.map((a) => a.id));
    const starts = achs.filter((a) => !a.requires || !ids.has(a.requires)).length;
    return starts + (achs.length - starts) * 0.6;
  };
  const ordered = [...fixedBranches].sort((a, b) => weightOf(b) - weightOf(a));

  const leftSide = ordered.filter((_, i) => i % 2 === 0);
  const rightSide = ordered.filter((_, i) => i % 2 === 1);

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
      return buildBranch(branch, byBranch.get(branch.id) ?? [], attach, dirAngle, BRANCH_CURL);
    });

  // Order matters for the trunk stripes: left side first, then right —
  // the renderer paints stripes across the trunk in this order.
  const branchLayouts: BranchLayout[] = [...buildSide(leftSide, true), ...buildSide(rightSide, false)];

  // No two fruits closer than MIN_FRUIT_DIST: push overlapping pairs apart,
  // then re-anchor the connector stubs to the settled positions.
  const allTwigs = branchLayouts.flatMap((b) => b.twigs);
  for (let iter = 0; iter < 30; iter++) {
    let anyMoved = false;
    for (let i = 0; i < allTwigs.length; i++) {
      for (let j = i + 1; j < allTwigs.length; j++) {
        const a = allTwigs[i].leaf.center;
        const b = allTwigs[j].leaf.center;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= MIN_FRUIT_DIST) continue;
        if (d < 0.01) {
          dx = 1;
          dy = 0;
          d = 1;
        }
        const push = (MIN_FRUIT_DIST - d) / 2 / d;
        a.x -= dx * push;
        a.y -= dy * push;
        b.x += dx * push;
        b.y += dy * push;
        anyMoved = true;
      }
    }
    if (!anyMoved) break;
  }
  const twigById = new Map(allTwigs.map((t) => [t.achievementId, t]));
  for (const t of allTwigs) {
    const parent = t.parentAchievementId ? twigById.get(t.parentAchievementId) : undefined;
    t.stub = [parent ? parent.leaf.center : t.stub[0], t.leaf.center];
  }

  // A tuft of leaves hugging every fruit (built after fruits settle so it
  // stays aligned). Each tuft is owned by its fruit and greens exactly when
  // that achievement is completed — so leaves surround every plod and the
  // green spreads right around the checked one.
  for (const branch of branchLayouts) {
    for (const twig of branch.twigs) {
      const fr = mulberry32(hashString(`fruitfol:${twig.achievementId}`));
      const ringCount = 7 + Math.floor(fr() * 3);
      for (let k = 0; k < ringCount; k++) {
        const a = (k / ringCount) * Math.PI * 2 + fr() * 0.8;
        const r = 10 + fr() * 9;
        const cluster = buildLeafCluster(
          { x: twig.leaf.center.x + Math.cos(a) * r, y: twig.leaf.center.y + Math.sin(a) * r },
          hashString(`fruitfol:${twig.achievementId}:${k}`),
        );
        cluster.ownerId = twig.achievementId;
        branch.foliage.push(cluster);
      }
    }
  }

  // Filler foliage keeps clear of the settled fruit positions so every fruit
  // sits in its own visual pocket (owned tufts hug their fruit on purpose),
  // and ALL foliage keeps clear of the trunk — leaves start out on the limbs,
  // not at the trunk, like on a real tree. The clearance stops short of the
  // trunk's top, so the crown closes over the tapering leader instead of
  // leaving a bare channel around it.
  const trunkClearancePath = trunk.path.slice(0, Math.floor(TRUNK_SEGMENTS * 0.86));
  for (const branch of branchLayouts) {
    branch.foliage = branch.foliage.filter(
      (leaf) =>
        trunkClearancePath.every((p) => dist(leaf.center, p) >= TRUNK_FOLIAGE_CLEARANCE) &&
        (leaf.ownerId !== undefined ||
          allTwigs.every((t) => dist(leaf.center, t.leaf.center) >= FOLIAGE_CLEARANCE)),
    );
  }

  const ground = buildGroundRoots(trunk.path[0]);
  const groundRoots = ground.layouts;
  const rootLayouts: RootLayout[] = customAchievements.map((custom, i) =>
    buildRoot(custom, ground.fork, i),
  );

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
  // Tree-only extents drive "показать всё"; the painted scene (sky, clouds,
  // grass, stones) continues far beyond them, so even fully zoomed out the
  // viewport stays inside the artwork instead of falling off its edge.
  const treeBounds: TreeBounds = { ...bounds };
  const margin = 700;
  bounds.minX -= margin;
  bounds.maxX += margin;
  bounds.minY -= margin;
  bounds.maxY += margin;

  return { trunk, branches: branchLayouts, roots: rootLayouts, groundRoots, bounds, treeBounds };
}
