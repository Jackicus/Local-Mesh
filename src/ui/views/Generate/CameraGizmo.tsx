import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { CameraPose } from './viewerStore';
import { viewerStore } from './viewerStore';

interface Axis {
  id: string;
  /** World direction the camera moves to when this handle is clicked. */
  dir: [number, number, number];
  letter: 'X' | 'Y' | 'Z';
  positive: boolean;
  label: string;
  /** The scene keeps the camera above the grid, so there is no view from below. */
  unreachable?: boolean;
}

const AXES: Axis[] = [
  { id: 'x+', dir: [1, 0, 0], letter: 'X', positive: true, label: 'Right view' },
  { id: 'y+', dir: [0, 1, 0], letter: 'Y', positive: true, label: 'Top view' },
  { id: 'z+', dir: [0, 0, 1], letter: 'Z', positive: true, label: 'Front view' },
  { id: 'x-', dir: [-1, 0, 0], letter: 'X', positive: false, label: 'Left view' },
  {
    id: 'y-',
    dir: [0, -1, 0],
    letter: 'Y',
    positive: false,
    label: 'Bottom view — the camera stays above the floor',
    unreachable: true,
  },
  { id: 'z-', dir: [0, 0, -1], letter: 'Z', positive: false, label: 'Back view' },
];

/** Half the plate, in px: everything below is laid out from the centre outwards. */
const RADIUS = 27;

// Scratch objects: the pose channel fires every frame, so nothing is allocated
// inside the update.
const scratchVector = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();

/** Rotate a world direction into view space — the camera's rotation, inverted. */
function toViewSpace(dir: [number, number, number], pose: CameraPose): THREE.Vector3 {
  scratchQuaternion.set(pose[0], pose[1], pose[2], pose[3]).invert();
  return scratchVector.set(dir[0], dir[1], dir[2]).applyQuaternion(scratchQuaternion);
}

/**
 * The navigation dial, top right of the viewport.
 *
 * Built in the DOM rather than with three's ViewHelper: that helper paints
 * fixed red/green/blue axes with black lettering into a corner of the WebGL
 * viewport, which neither takes the app's tokens nor survives a theme change,
 * and its hit-testing would have to be carved out of the canvas OrbitControls
 * already owns. Here each handle is a real button — tokenised, focusable,
 * labelled — and the only thing that ticks per frame is six transforms written
 * straight to the DOM, so orbiting costs no React render.
 */
export const CameraGizmo: React.FC = () => {
  const handleRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const spokeRefs = useRef<Record<string, SVGLineElement | null>>({});

  useEffect(
    () =>
      viewerStore.subscribeCameraPose((pose) => {
        for (const axis of AXES) {
          const el = handleRefs.current[axis.id];
          if (!el) continue;
          const { x: vx, y: vy, z: vz } = toViewSpace(axis.dir, pose);
          // vz runs -1 (behind the dial) to 1 (pointing at the viewer); depth
          // is the whole readout, so it drives size, weight and stacking.
          const depth = (vz + 1) / 2;
          el.style.transform = `translate(calc(-50% + ${(vx * RADIUS).toFixed(2)}px), calc(-50% + ${(-vy * RADIUS).toFixed(2)}px)) scale(${(0.74 + depth * 0.26).toFixed(3)})`;
          el.style.opacity = (0.4 + depth * 0.6).toFixed(3);
          el.style.zIndex = String(Math.round(depth * 100));
          const spoke = spokeRefs.current[axis.id];
          if (spoke) {
            spoke.setAttribute('x2', String(RADIUS + vx * RADIUS));
            spoke.setAttribute('y2', String(RADIUS - vy * RADIUS));
            spoke.style.opacity = (0.18 + depth * 0.5).toFixed(3);
          }
        }
      }),
    []
  );

  return (
    <div className="gen-gizmo" role="group" aria-label="Camera orientation">
      <svg className="gen-gizmo-spokes" viewBox={`0 0 ${RADIUS * 2} ${RADIUS * 2}`} aria-hidden="true">
        {AXES.filter((a) => a.positive).map((axis) => (
          <line
            key={axis.id}
            ref={(el) => {
              spokeRefs.current[axis.id] = el;
            }}
            x1={RADIUS}
            y1={RADIUS}
            x2={RADIUS}
            y2={RADIUS}
          />
        ))}
      </svg>

      {AXES.map((axis) => (
        <button
          key={axis.id}
          type="button"
          ref={(el) => {
            handleRefs.current[axis.id] = el;
          }}
          className={`gen-gizmo-axis ${axis.positive ? 'is-positive' : 'is-negative'}`}
          title={axis.label}
          aria-label={axis.label}
          disabled={axis.unreachable}
          onClick={() => viewerStore.snapToAxis(...axis.dir)}
        >
          {axis.positive && <span aria-hidden="true">{axis.letter}</span>}
        </button>
      ))}
    </div>
  );
};
