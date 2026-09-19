import React, { useEffect, useState } from 'react';
import type { MeshOp } from '../../../../core/generation';
import { MAX_SMOOTH_ITERATIONS, MIN_DECIMATE_FACES } from '../../../../core/generation';
import { Form } from '../../../components';
import { FieldLabel } from '../InfoTip';

export interface MeshOpNodeProps {
  /** The node's op, already normalized from its data. */
  op: MeshOp;
  onChange: (patch: Record<string, unknown>) => void;
}

const THRESHOLDS = [
  { value: '0.02', label: '2%' },
  { value: '0.1', label: '10%' },
  { value: '0.25', label: '25%' },
];

const MODES = [
  { value: 'faces' as const, label: 'Max faces' },
  { value: 'ratio' as const, label: 'Ratio' },
];

const RATIOS = [
  { value: '0.5', label: '50%' },
  { value: '0.25', label: '25%' },
  { value: '0.1', label: '10%' },
];

interface ClampedNumberProps {
  value: number;
  min: number;
  max?: number;
  step?: number;
  label: string;
  onCommit: (value: number) => void;
}

/**
 * A number box that clamps on commit, not on keystroke. Clamping as you type
 * makes a field with a floor unusable — typing "20000" into a max-faces box
 * snaps to the minimum on the first digit and eats the rest.
 */
const ClampedNumber: React.FC<ClampedNumberProps> = ({ value, min, max, step, label, onCommit }) => {
  const [draft, setDraft] = useState(String(value));
  // Follow the node's value when it changes from elsewhere (undo, a reload).
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const n = Number(draft);
    const next = Number.isFinite(n) && draft.trim() !== '' ? Math.min(max ?? Infinity, Math.max(min, Math.round(n))) : value;
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  return (
    <Form.Input
      size="sm"
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
};

/**
 * The body for every mesh op node. One component rather than six files: the
 * ops share a data shape (the op minus its kind) and most have a field or two.
 */
export const MeshOpNode: React.FC<MeshOpNodeProps> = ({ op, onChange }) => {
  switch (op.op) {
    case 'remove-floaters':
      return (
        <>
          <div className="pipe-field">
            <FieldLabel
              label="Keep parts above"
              info="A part is kept when it has at least this share of the largest part's faces. 2% only sweeps up specks; 25% is aggressive and will delete real details like a handle or an ear."
            />
            <Form.Segmented
              size="sm"
              fullWidth
              options={THRESHOLDS}
              value={String(op.threshold)}
              onChange={(threshold) => onChange({ threshold: Number(threshold) })}
            />
          </div>
          <p className="pipe-note">Of the largest connected part; everything smaller is dropped.</p>
        </>
      );

    case 'remove-degenerate':
      return (
        <>
          <div className="pipe-field row">
            <FieldLabel
              label="Merge vertices"
              info="Welds vertices that sit in the same place first, so cracks and seams close and the faces between them collapse away. Turn it off to keep hard edges exactly as the model made them."
            />
            <Form.Toggle
              size="sm"
              checked={op.mergeVertices}
              onChange={(mergeVertices) => onChange({ mergeVertices })}
              aria-label="Merge duplicate vertices"
            />
          </div>
          <p className="pipe-note">
            {op.mergeVertices
              ? 'Welds duplicate vertices first, so seams collapse too.'
              : 'Zero-area faces only; duplicate vertices are left alone.'}
          </p>
        </>
      );

    case 'fill-holes':
      return <p className="pipe-note">Closes small boundary loops. Large openings are left as they are.</p>;

    case 'decimate':
      return (
        <>
          <div className="pipe-field">
            <FieldLabel
              label="Target"
              info="How the budget is set: a hard cap on faces, or a fraction of whatever the mesh arrives with. A cap is predictable, a ratio scales with the model."
            />
            <Form.Segmented<'faces' | 'ratio'>
              size="sm"
              fullWidth
              options={MODES}
              value={op.mode}
              onChange={(mode) => onChange({ mode })}
            />
          </div>
          {op.mode === 'faces' ? (
            <div className="pipe-field">
              <FieldLabel
                label="Max faces"
                info="Face count to come down to. Around 50k is comfortable for real-time viewing, 200k keeps fine detail; below ~5k the silhouette starts to break."
              />
              <ClampedNumber
                value={op.maxFaces}
                min={MIN_DECIMATE_FACES}
                step={1000}
                label="Max faces"
                onCommit={(maxFaces) => onChange({ maxFaces })}
              />
              <span className="pipe-hint">A mesh already under the cap passes through.</span>
            </div>
          ) : (
            <div className="pipe-field">
              <FieldLabel
                label="Keep"
                info="Fraction of the incoming faces to keep. Halving is usually invisible; 10% is a proxy-mesh setting."
              />
              <Form.Segmented
                size="sm"
                fullWidth
                options={RATIOS}
                value={String(op.ratio)}
                onChange={(ratio) => onChange({ ratio: Number(ratio) })}
              />
            </div>
          )}
        </>
      );

    case 'smooth':
      return (
        <div className="pipe-field">
          <FieldLabel
            label="Passes"
            info="How many smoothing sweeps to run. A handful takes the stair-stepping off marching cubes; dozens start softening detail away. Cheap either way."
          />
          <ClampedNumber
            value={op.iterations}
            min={1}
            max={MAX_SMOOTH_ITERATIONS}
            step={5}
            label="Smoothing passes"
            onCommit={(iterations) => onChange({ iterations })}
          />
          <span className="pipe-hint">Taubin smoothing; the volume stays where it was.</span>
        </div>
      );

    case 'recompute-normals':
      return <p className="pipe-note">Rebuilds normals and winding. Fixes dark or inside-out shading.</p>;
  }
};
