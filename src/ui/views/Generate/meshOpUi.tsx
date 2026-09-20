import React from 'react';
import type { MeshOp, MeshOpKind } from '../../../core/types';
import { MESH_OP_DEFINITIONS } from '../../../core/types';
import { Form } from '../../components';
import {
  CleanIcon,
  FillHolesIcon,
  FloatersIcon,
  NormalsIcon,
  ReduceIcon,
  SmoothIcon,
} from '../../assets/icons';
import { formatCount } from './format';

/**
 * The controls for a mesh op's options, and the glyph that stands for it.
 *
 * There are two places the same six ops are configured — a modifier on a job
 * that has not run, and a hand edit on a job that has — and they were never
 * going to stay in step as two copies of the same switch statement. This is
 * the one copy. It takes an op and gives back an op, so neither caller has to
 * know that Decimate has two modes or that Smooth counts passes.
 */

export const MESH_OP_ICONS: Record<MeshOpKind, React.ReactNode> = {
  'remove-floaters': <FloatersIcon size={14} />,
  'remove-degenerate': <CleanIcon size={14} />,
  'fill-holes': <FillHolesIcon size={14} />,
  decimate: <ReduceIcon size={14} />,
  smooth: <SmoothIcon size={14} />,
  'recompute-normals': <NormalsIcon size={14} />,
};

const THRESHOLDS = [
  { value: '0.02', label: '2%' },
  { value: '0.1', label: '10%' },
  { value: '0.25', label: '25%' },
];

const RATIOS = [
  { value: '0.5', label: '50%' },
  { value: '0.25', label: '25%' },
  { value: '0.1', label: '10%' },
];

const ITERATIONS = [
  { value: '5', label: 'Light' },
  { value: '15', label: 'Medium' },
  { value: '40', label: 'Strong' },
];

/**
 * Hand-editing a mesh you are looking at means "half of this", not "cap it at
 * fifty thousand"; a modifier queued before the mesh exists has no current
 * count to halve, so it keeps the registry's face cap. Same op, different
 * starting point, which is exactly what a default is for.
 */
export function defaultOp(kind: MeshOpKind, mode: 'tool' | 'modifier'): MeshOp {
  const op = MESH_OP_DEFINITIONS[kind].defaults();
  if (mode === 'tool' && op.op === 'decimate') return { ...op, mode: 'ratio' };
  return op;
}

/** "Smooth ×15", "Reduce to 50%" — what a chip or a revision says it is. */
export function opSummary(op: MeshOp): string {
  const short = MESH_OP_DEFINITIONS[op.op].short;
  switch (op.op) {
    case 'remove-floaters':
      return `${short} under ${Math.round(op.threshold * 100)}%`;
    case 'decimate':
      return op.mode === 'ratio' ? `${short} to ${Math.round(op.ratio * 100)}%` : `${short} to ${formatCount(op.maxFaces)}`;
    case 'smooth':
      return `${short} ×${op.iterations}`;
    default:
      return short;
  }
}

export interface MeshOpOptionsProps {
  op: MeshOp;
  onChange: (op: MeshOp) => void;
  /** Current face count, when there is a mesh to measure against. */
  faces?: number;
}

/**
 * Whatever this op has to decide, or null when it has nothing to ask. A caller
 * that gets null should apply the op on click rather than opening a panel for
 * an empty form.
 */
export const MeshOpOptions: React.FC<MeshOpOptionsProps> = ({ op, onChange, faces = 0 }) => {
  switch (op.op) {
    case 'remove-floaters':
      return (
        <>
          <span className="gen-popover-title">Keep parts above</span>
          <Form.Segmented
            size="sm"
            fullWidth
            options={THRESHOLDS}
            value={String(op.threshold)}
            onChange={(threshold) => onChange({ ...op, threshold: Number(threshold) })}
          />
          <div className="gen-popover-meta">
            <span>Of the largest part</span>
          </div>
        </>
      );
    case 'remove-degenerate':
      return (
        <div className="gen-popover-meta">
          <span>Merge vertices</span>
          <Form.Toggle
            size="sm"
            checked={op.mergeVertices}
            onChange={(mergeVertices) => onChange({ ...op, mergeVertices })}
            aria-label="Merge duplicate vertices"
          />
        </div>
      );
    case 'decimate':
      return op.mode === 'ratio' ? (
        <>
          <span className="gen-popover-title">Target faces</span>
          <Form.Segmented
            size="sm"
            fullWidth
            options={RATIOS}
            value={String(op.ratio)}
            onChange={(ratio) => onChange({ ...op, ratio: Number(ratio) })}
          />
          <div className="gen-popover-meta">
            <span>{formatCount(faces)} now</span>
            <span>→ {formatCount(Math.round(faces * op.ratio))}</span>
          </div>
        </>
      ) : (
        <>
          <span className="gen-popover-title">Face limit</span>
          <Form.Input
            size="sm"
            type="number"
            min={100}
            step={1000}
            aria-label="Face limit"
            value={op.maxFaces}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n >= 100) onChange({ ...op, maxFaces: Math.round(n) });
            }}
          />
          <div className="gen-popover-meta">
            <span>A mesh already under it is left alone</span>
          </div>
        </>
      );
    case 'smooth':
      return (
        <>
          <span className="gen-popover-title">Smoothing</span>
          <Form.Segmented
            size="sm"
            fullWidth
            options={ITERATIONS}
            value={String(op.iterations)}
            onChange={(iterations) => onChange({ ...op, iterations: Number(iterations) })}
          />
          <div className="gen-popover-meta">
            <span>Taubin</span>
            <span>{op.iterations} passes</span>
          </div>
        </>
      );
    default:
      return null;
  }
};

/** True when MeshOpOptions would render something worth opening a panel for. */
export function hasOptions(op: MeshOp): boolean {
  return op.op === 'remove-floaters' || op.op === 'remove-degenerate' || op.op === 'decimate' || op.op === 'smooth';
}
