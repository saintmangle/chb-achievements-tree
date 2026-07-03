export interface Point {
  x: number;
  y: number;
}

export interface LeafCluster {
  center: Point;
  blocks: Point[];
  radius: number;
}

export interface TwigLayout {
  achievementId: string;
  branchId: number;
  title: string;
  description: string;
  stub: [Point, Point];
  leaf: LeafCluster;
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
  bounds: TreeBounds;
}
