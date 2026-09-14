import { useCallback, useRef, useState } from 'react';
import type { Pipeline } from '../../../core/pipeline';
import {
  DEFAULT_NODE_H,
  MAX_ZOOM,
  MIN_ZOOM,
  NODE_W,
  clamp,
  type Bounds,
  type Point,
  type Viewport,
} from './canvasGeometry';

/**
 * Pan/zoom state for the node canvas. The value lives in both React state
 * (for rendering) and a ref (for pointer maths mid-gesture without stale
 * closures). Live drags may write the transform straight to the DOM through
 * `applyLive`, then `setViewport` commits once on release.
 */
export interface CanvasViewport {
  viewport: Viewport;
  viewportRef: React.RefObject<Viewport>;
  surfaceRef: React.RefObject<HTMLDivElement | null>;
  worldRef: React.RefObject<HTMLDivElement | null>;
  setViewport: (v: Viewport) => void;
  /** Paint a viewport without committing to state (drag frames). */
  applyLive: (v: Viewport) => void;
  toCanvas: (clientX: number, clientY: number) => Point;
  zoomAt: (clientX: number, clientY: number, factor: number) => void;
  fitBounds: (bounds: Bounds) => void;
  fitToNodes: (pipeline: Pipeline) => void;
  /** Canvas-space point at the centre of the visible surface. */
  visibleCenter: () => Point;
}

export function gridStyle(v: Viewport): React.CSSProperties {
  return {
    backgroundPosition: `${v.x}px ${v.y}px`,
    backgroundSize: `${24 * v.zoom}px ${24 * v.zoom}px`,
  };
}

/**
 * `rightInset` is the width of the canvas hidden behind the floating dock:
 * fitting and centring aim at what the user can actually see. A ref keeps the
 * current value out of the callbacks' dependency lists.
 */
export function useCanvasViewport(rightInset = 0): CanvasViewport {
  const [viewport, setState] = useState<Viewport>({ x: 40, y: 40, zoom: 1 });
  const viewportRef = useRef<Viewport>(viewport);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const insetRef = useRef(rightInset);
  insetRef.current = rightInset;

  const applyLive = useCallback((v: Viewport) => {
    viewportRef.current = v;
    if (worldRef.current) {
      worldRef.current.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;
    }
    if (surfaceRef.current) {
      const g = gridStyle(v);
      surfaceRef.current.style.backgroundPosition = g.backgroundPosition as string;
      surfaceRef.current.style.backgroundSize = g.backgroundSize as string;
    }
  }, []);

  const setViewport = useCallback(
    (v: Viewport) => {
      applyLive(v);
      setState(v);
    },
    [applyLive]
  );

  const toCanvas = useCallback((clientX: number, clientY: number): Point => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    const v = viewportRef.current;
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    return { x: (clientX - left - v.x) / v.zoom, y: (clientY - top - v.y) / v.zoom };
  }, []);

  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      const v = viewportRef.current;
      const zoom = clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      if (zoom === v.zoom) return;
      // Keep the canvas point under the cursor fixed while the scale changes.
      const px = clientX - (rect?.left ?? 0);
      const py = clientY - (rect?.top ?? 0);
      const cx = (px - v.x) / v.zoom;
      const cy = (py - v.y) / v.zoom;
      setViewport({ x: px - cx * zoom, y: py - cy * zoom, zoom });
    },
    [setViewport]
  );

  const fitBounds = useCallback(
    (b: Bounds) => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const pad = 48;
      const usableW = Math.max(pad * 2 + 1, rect.width - insetRef.current);
      const w = Math.max(1, b.maxX - b.minX);
      const h = Math.max(1, b.maxY - b.minY);
      const zoom = clamp(Math.min((usableW - pad * 2) / w, (rect.height - pad * 2) / h), MIN_ZOOM, 1.25);
      setViewport({
        x: (usableW - w * zoom) / 2 - b.minX * zoom,
        y: (rect.height - h * zoom) / 2 - b.minY * zoom,
        zoom,
      });
    },
    [setViewport]
  );

  const fitToNodes = useCallback(
    (pipeline: Pipeline) => {
      if (pipeline.nodes.length === 0) {
        setViewport({ x: 40, y: 40, zoom: 1 });
        return;
      }
      const heights = new Map<string, number>();
      surfaceRef.current?.querySelectorAll<HTMLElement>('[data-node-id]').forEach((el) => {
        heights.set(el.dataset['nodeId'] ?? '', el.offsetHeight);
      });
      const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (const n of pipeline.nodes) {
        b.minX = Math.min(b.minX, n.position.x);
        b.minY = Math.min(b.minY, n.position.y);
        b.maxX = Math.max(b.maxX, n.position.x + NODE_W);
        b.maxY = Math.max(b.maxY, n.position.y + (heights.get(n.id) ?? DEFAULT_NODE_H));
      }
      fitBounds(b);
    },
    [fitBounds, setViewport]
  );

  const visibleCenter = useCallback((): Point => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return toCanvas(rect.left + (rect.width - insetRef.current) / 2, rect.top + rect.height / 2);
  }, [toCanvas]);

  return {
    viewport,
    viewportRef,
    surfaceRef,
    worldRef,
    setViewport,
    applyLive,
    toCanvas,
    zoomAt,
    fitBounds,
    fitToNodes,
    visibleCenter,
  };
}
