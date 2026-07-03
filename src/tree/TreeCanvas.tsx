import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ProgressMap } from "../types";
import { hitTest, renderTree, type HitTarget } from "./renderer";
import type { Point, TreeLayout } from "./types";

export interface TreeCanvasHandle {
  fitAll: () => void;
}

interface Camera {
  scale: number;
  tx: number;
  ty: number;
}

interface TreeCanvasProps {
  layout: TreeLayout;
  progress: ProgressMap;
  onSelect: (target: HitTarget | null, screen: Point | null) => void;
  activeId: string | null;
}

const MAX_SCALE = 6;
const TAP_MOVE_THRESHOLD = 8;
const TAP_MAX_DURATION = 500;
const HIT_RADIUS_SCREEN_PX = 10;

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export const TreeCanvas = forwardRef<TreeCanvasHandle, TreeCanvasProps>(function TreeCanvas(
  { layout, progress, onSelect, activeId },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [camera, setCamera] = useState<Camera>({ scale: 1, tx: 0, ty: 0 });
  const minScaleRef = useRef(0.15);

  const pointers = useRef(new Map<number, Point>());
  const dragState = useRef<{ startScreen: Point; startTime: number; moved: boolean } | null>(null);
  const panState = useRef<{ lastX: number; lastY: number } | null>(null);
  const pinchState = useRef<{
    startDist: number;
    startScale: number;
    startMid: Point;
    startTx: number;
    startTy: number;
  } | null>(null);

  const canvasWidth = Math.ceil(layout.bounds.maxX - layout.bounds.minX);
  const canvasHeight = Math.ceil(layout.bounds.maxY - layout.bounds.minY);

  const draw = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    renderTree(ctx, layout, { progress, highlightedId: activeId });
  }, [layout, progress, activeId]);

  useEffect(() => {
    draw();
  }, [draw]);

  const fitAll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (!cw || !ch) return;
    const scale = Math.min(cw / canvasWidth, ch / canvasHeight) * 0.92;
    minScaleRef.current = scale * 0.6;
    const tx = (cw - canvasWidth * scale) / 2;
    const ty = (ch - canvasHeight * scale) / 2 + ch * 0.05;
    setCamera({ scale, tx, ty });
  }, [canvasWidth, canvasHeight]);

  useImperativeHandle(ref, () => ({ fitAll }), [fitAll]);

  useEffect(() => {
    fitAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasWidth, canvasHeight]);

  const screenToWorld = useCallback(
    (screen: Point): Point => {
      const cx = (screen.x - camera.tx) / camera.scale;
      const cy = (screen.y - camera.ty) / camera.scale;
      return { x: cx + layout.bounds.minX, y: cy + layout.bounds.minY };
    },
    [camera, layout.bounds],
  );

  const worldToScreen = useCallback(
    (world: Point): Point => {
      const cx = world.x - layout.bounds.minX;
      const cy = world.y - layout.bounds.minY;
      return { x: cx * camera.scale + camera.tx, y: cy * camera.scale + camera.ty };
    },
    [camera, layout.bounds],
  );

  const toContainerPoint = useCallback((clientX: number, clientY: number): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }, []);

  const handleTap = useCallback(
    (screen: Point) => {
      const world = screenToWorld(screen);
      const target = hitTest(layout, world, HIT_RADIUS_SCREEN_PX / camera.scale);
      if (!target) {
        onSelect(null, null);
        return;
      }
      const anchorScreen = worldToScreen(target.screenAnchor);
      onSelect(target, anchorScreen);
    },
    [layout, screenToWorld, worldToScreen, camera.scale, onSelect],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toContainerPoint(e.clientX, e.clientY);
    pointers.current.set(e.pointerId, p);

    if (pointers.current.size === 1) {
      dragState.current = { startScreen: p, startTime: Date.now(), moved: false };
      panState.current = { lastX: p.x, lastY: p.y };
    } else if (pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values());
      pinchState.current = {
        startDist: dist(a, b),
        startScale: camera.scale,
        startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        startTx: camera.tx,
        startTy: camera.ty,
      };
      panState.current = null;
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = toContainerPoint(e.clientX, e.clientY);
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, p);
    }

    if (pointers.current.size === 2 && pinchState.current) {
      const [a, b] = Array.from(pointers.current.values());
      const newDist = dist(a, b);
      const factor = newDist / (pinchState.current.startDist || 1);
      const newScale = clamp(pinchState.current.startScale * factor, minScaleRef.current, MAX_SCALE);
      const mid = pinchState.current.startMid;
      const worldAtMid = {
        x: (mid.x - pinchState.current.startTx) / pinchState.current.startScale,
        y: (mid.y - pinchState.current.startTy) / pinchState.current.startScale,
      };
      setCamera({
        scale: newScale,
        tx: mid.x - worldAtMid.x * newScale,
        ty: mid.y - worldAtMid.y * newScale,
      });
      return;
    }

    if (pointers.current.size === 1 && panState.current && dragState.current) {
      const dx = p.x - panState.current.lastX;
      const dy = p.y - panState.current.lastY;
      const totalMove = dist(dragState.current.startScreen, p);
      if (totalMove > TAP_MOVE_THRESHOLD) dragState.current.moved = true;
      if (dragState.current.moved) {
        setCamera((c) => ({ ...c, tx: c.tx + dx, ty: c.ty + dy }));
      }
      panState.current = { lastX: p.x, lastY: p.y };
      return;
    }

    if (pointers.current.size === 0 && e.pointerType === "mouse") {
      const world = screenToWorld(p);
      const target = hitTest(layout, world, HIT_RADIUS_SCREEN_PX / camera.scale);
      if (target) {
        onSelect(target, worldToScreen(target.screenAnchor));
      } else if (!activeId) {
        onSelect(null, null);
      }
    }
  };

  const endPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const wasSingle = pointers.current.size === 1;
    const drag = dragState.current;
    pointers.current.delete(e.pointerId);

    if (pointers.current.size < 2) pinchState.current = null;
    if (pointers.current.size === 0) panState.current = null;

    if (wasSingle && drag && !drag.moved && Date.now() - drag.startTime < TAP_MAX_DURATION) {
      handleTap(toContainerPoint(e.clientX, e.clientY));
    }
    dragState.current = null;
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const cursor = toContainerPoint(e.clientX, e.clientY);
    const factor = Math.exp(-e.deltaY * 0.0015);
    setCamera((c) => {
      const newScale = clamp(c.scale * factor, minScaleRef.current, MAX_SCALE);
      const worldAtCursor = { x: (cursor.x - c.tx) / c.scale, y: (cursor.y - c.ty) / c.scale };
      return {
        scale: newScale,
        tx: cursor.x - worldAtCursor.x * newScale,
        ty: cursor.y - worldAtCursor.y * newScale,
      };
    });
  };

  return (
    <div
      ref={containerRef}
      className="tree-viewport"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onPointerLeave={(e) => {
        if (pointers.current.size === 0 && e.pointerType === "mouse") onSelect(null, null);
      }}
      onWheel={handleWheel}
    >
      <canvas
        ref={canvasRef}
        className="tree-canvas"
        style={{
          transform: `translate(${camera.tx}px, ${camera.ty}px) scale(${camera.scale})`,
        }}
      />
    </div>
  );
});

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
