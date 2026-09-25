import * as THREE from 'three';

/**
 * The scene takes its palette from the page tokens so the viewport is the
 * same sheet as the rest of the app: background = --bg-app (the canvas is
 * transparent; the page paints the lightbox behind it), the drafting grid in
 * neutral --border-* (major lines one step stronger than fine ones), and the
 * two floor axes in --axis-x / --axis-z, the colours the camera dial uses. Colours are resolved at runtime
 * (tokens may be hex or oklch) and re-read on theme changes.
 */
export interface SceneColors {
  background: THREE.Color;
  accent: THREE.Color;
  axisX: THREE.Color;
  axisZ: THREE.Color;
  /** Fine 1-unit lines. */
  gridFine: THREE.Color;
  /** Major 5-unit lines — same neutral family, a step stronger. */
  gridMajor: THREE.Color;
}

let probe: CanvasRenderingContext2D | null | undefined;

function probeContext(): CanvasRenderingContext2D | null {
  if (probe !== undefined) return probe;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    probe = canvas.getContext('2d', { willReadFrequently: true });
  } catch {
    probe = null;
  }
  return probe;
}

/**
 * Resolve any CSS colour string (hex, rgb, oklch, relative colour syntax) to
 * sRGB bytes by painting it on a 1×1 canvas — the browser does the parsing.
 */
export function cssColorToThree(value: string, fallback: string): THREE.Color {
  const ctx = probeContext();
  if (!ctx) return new THREE.Color().setStyle(fallback);
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = fallback;
  ctx.fillStyle = value; // invalid values leave the fallback in place
  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
  return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
}

function token(name: string, fallback: string): THREE.Color {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return cssColorToThree(raw || fallback, fallback);
}

export function readSceneColors(): SceneColors {
  return {
    background: token('--bg-app', '#0e1013'),
    accent: token('--accent', '#56c8e0'),
    axisX: token('--axis-x', '#d9535a'),
    axisZ: token('--axis-z', '#4c8fe0'),
    gridFine: token('--border-subtle', '#24262b'),
    gridMajor: token('--border-strong', '#373a40'),
  };
}

/** Fires after the theme or accent attribute on <html> changes. */
export function watchTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-accent'],
  });
  return () => observer.disconnect();
}
