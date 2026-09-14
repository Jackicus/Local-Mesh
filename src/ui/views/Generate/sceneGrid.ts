import * as THREE from 'three';
import type { SceneColors } from './sceneTheme';

/**
 * The drafting grid: 1-unit cells across 40×40, a slightly stronger line every
 * 5 units, and the two axes through the origin — the only coloured lines in the
 * scene. The three layers never share a line (fine skips multiples of 5, major
 * skips 0), so nothing z-fights. Instead of transparency the lines are mixed
 * toward the background per vertex — a radial fade that holds still while the
 * camera moves, which fog would not.
 */
const HALF = 20;
const MAJOR_EVERY = 5;
const FADE_START = 8;
const FADE_END = HALF;

/** How far each layer travels from the background toward its own colour. */
const FINE_MIX = 0.85;
const MAJOR_MIX = 1;
const AXIS_MIX = 1;

type Layer = 'fine' | 'major' | 'axis';

function layerOf(coord: number): Layer {
  if (coord === 0) return 'axis';
  return coord % MAJOR_EVERY === 0 ? 'major' : 'fine';
}

/**
 * One base colour per layer, all three re-derived whenever the theme or accent
 * changes. Fine and major are neutral (--border-subtle / --border-strong, each
 * of which sits on the readable side of --bg-app in both themes); only the axes
 * carry the accent.
 */
function layerBases(colors: SceneColors): Record<Layer, THREE.Color> {
  const bg = colors.background;
  return {
    fine: bg.clone().lerp(colors.gridFine, FINE_MIX),
    major: bg.clone().lerp(colors.gridMajor, MAJOR_MIX),
    axis: bg.clone().lerp(colors.accent, AXIS_MIX),
  };
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

interface LayerBuffers {
  positions: number[];
  colors: number[];
}

function pushSegment(
  buf: LayerBuffers,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  base: THREE.Color,
  bg: THREE.Color,
  scratch: THREE.Color
) {
  for (const [x, z] of [
    [ax, az],
    [bx, bz],
  ] as const) {
    const r = Math.hypot(x, z);
    scratch.copy(base).lerp(bg, smoothstep(FADE_START, FADE_END, r));
    buf.positions.push(x, 0, z);
    buf.colors.push(scratch.r, scratch.g, scratch.b);
  }
}

function toLines(buf: LayerBuffers): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(buf.positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(buf.colors, 3));
  const material = new THREE.LineBasicMaterial({ vertexColors: true, toneMapped: false });
  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = false;
  return lines;
}

export function buildGrid(colors: SceneColors): THREE.Group {
  const bg = colors.background;
  const base = layerBases(colors);
  const buffers: Record<Layer, LayerBuffers> = {
    fine: { positions: [], colors: [] },
    major: { positions: [], colors: [] },
    axis: { positions: [], colors: [] },
  };
  const scratch = new THREE.Color();

  for (let c = -HALF; c <= HALF; c += 1) {
    const layer = layerOf(c);
    const buf = buffers[layer];
    // One unit at a time so the per-vertex fade stays radial along the line.
    for (let s = -HALF; s < HALF; s += 1) {
      pushSegment(buf, s, c, s + 1, c, base[layer], bg, scratch); // along x
      pushSegment(buf, c, s, c, s + 1, base[layer], bg, scratch); // along z
    }
  }

  const group = new THREE.Group();
  group.name = 'grid';
  group.add(toLines(buffers.fine), toLines(buffers.major), toLines(buffers.axis));
  return group;
}

export function disposeGrid(group: THREE.Group): void {
  group.traverse((o) => {
    const lines = o as THREE.LineSegments;
    if (lines.geometry) lines.geometry.dispose();
    if (lines.material) (lines.material as THREE.Material).dispose();
  });
}
