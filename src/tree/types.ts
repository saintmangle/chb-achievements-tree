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
  bounds: TreeBounds;
}
