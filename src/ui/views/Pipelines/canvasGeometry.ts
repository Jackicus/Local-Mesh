import type { NodeType, PipelineNode, PortType } from '../../../core/pipeline';

/**
 * Fixed node metrics shared by the CSS and the edge maths. Port centres are
 * derived from `node.position` + these constants, so edges never need to
 * measure the DOM. Keep in sync with `.pipe-node-header` / `.pipe-port-item`
 * heights in pipelines.css.
 */
export const NODE_W = 260;
export const NODE_BORDER = 1;
export const NODE_HEADER_H = 36;
export const PORT_ROW_H = 26;
/** Fallback height for zoom-to-fit when a node has not rendered yet. */
export const DEFAULT_NODE_H = 180;

/**
 * Width the open dock takes out of the canvas: the panel plus the inset on
 * either side of it. Keep in sync with `--pipe-dock-width` / `--pipe-inset`.
 */
export const DOCK_RESERVE = 340 + 12 * 2;

export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 2;
export const GRID_SIZE = 24;

export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type PortDirection = 'in' | 'out';

export function portPosition(node: PipelineNode, dir: PortDirection, index: number): Point {
  return {
    x: node.position.x + (dir === 'out' ? NODE_W : 0),
    y: node.position.y + NODE_BORDER + NODE_HEADER_H + PORT_ROW_H * index + PORT_ROW_H / 2,
  };
}

/** Cubic bezier with horizontal tangents, the classic node-editor wire. */
export function bezierPath(a: Point, b: Point): string {
  const dx = Math.max(48, Math.abs(b.x - a.x) * 0.5);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

/** Midpoint of the bezier above (t = 0.5). */
export function bezierMidpoint(a: Point, b: Point): Point {
  const dx = Math.max(48, Math.abs(b.x - a.x) * 0.5);
  const x = 0.125 * a.x + 0.375 * (a.x + dx) + 0.375 * (b.x - dx) + 0.125 * b.x;
  const y = 0.5 * (a.y + b.y);
  return { x, y };
}

export function portColor(type: PortType): string {
  return type === 'image' ? 'var(--pipe-image)' : 'var(--pipe-mesh)';
}

/** Which of the two hues a node card belongs to (based on what it emits). */
export function nodeHue(type: NodeType): PortType {
  return type === 'image-input' || type === 'background-removal' ? 'image' : 'mesh';
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
