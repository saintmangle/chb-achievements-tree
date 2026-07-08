export interface Point {
  x: number;
  y: number;
}

export interface LeafCluster {
  center: Point;
  blocks: Point[];
  radius: number;
  /** If set, this decorative cluster belongs to one fruit and greens exactly when it's completed. */
  ownerId?: string;
}

export interface TwigLayout {
  achievementId: string;
  branchId: number;
  title: string;
  description: string;
  stub: [Point, Point];
  leaf: LeafCluster;
  /** For chained achievements: the achievement this one grows out of. */
  parentAchievementId?: string;
}

export interface BranchLayout {
  branchId: number;
  title: string;
  path: Point[];
  baseWidth: number;
  tipWidth: number;
  twigs: TwigLayout[];
  /** Decorative (non-interactive) leaf clusters that make the crown look lush. */
  foliage: LeafCluster[];
}

export interface RootLayout {
  customId: string;
  text: string;
  status: boolean;
  path: Point[];
  baseWidth: number;
  tipWidth: number;
  leaf: LeafCluster;
}

/** Decorative root with no achievement attached — the tree always has some roots. */
export interface GroundRootLayout {
  path: Point[];
  baseWidth: number;
  tipWidth: number;
}

export interface TrunkLayout {
  path: Point[];
  widths: number[];
}

export interface TreeBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface TreeLayout {
  trunk: TrunkLayout;
  branches: BranchLayout[];
  roots: RootLayout[];
  groundRoots: GroundRootLayout[];
  /** Two decorative limbs the trunk splits into at its top. */
  crownForks: GroundRootLayout[];
  /** Full canvas extents including the scenery apron around the tree. */
  bounds: TreeBounds;
  /** Extents of the tree itself — what "показать всё" fits to the screen. */
  treeBounds: TreeBounds;
}
