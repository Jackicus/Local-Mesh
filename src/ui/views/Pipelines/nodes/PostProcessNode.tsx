import React from 'react';
import type { PostProcessData } from '../../../../core/pipeline';
import { Form } from '../../../components';
import type { NodeBodyProps } from './types';

const DEFAULT_MAX_FACES = 50000;

const ToggleRow: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void }> = ({ label, checked, onChange }) => (
  <div className="pipe-field row">
    <span className="pipe-field-label">{label}</span>
    <Form.Toggle size="sm" checked={checked} onChange={onChange} aria-label={label} />
  </div>
);

export const PostProcessNode: React.FC<NodeBodyProps<PostProcessData>> = ({ data, onChange }) => (
  <>
    <ToggleRow label="Remove floaters" checked={data.removeFloaters} onChange={(removeFloaters) => onChange({ removeFloaters })} />
    <ToggleRow label="Remove degenerate faces" checked={data.removeDegenerateFaces} onChange={(removeDegenerateFaces) => onChange({ removeDegenerateFaces })} />
    <ToggleRow label="Smooth normals" checked={data.smoothNormals} onChange={(smoothNormals) => onChange({ smoothNormals })} />
    <ToggleRow label="Limit faces" checked={data.maxFaces !== null} onChange={(on) => onChange({ maxFaces: on ? DEFAULT_MAX_FACES : null })} />
    {data.maxFaces !== null && (
      <div className="pipe-field">
        <span className="pipe-field-label">Max faces</span>
        <Form.Input
          size="sm"
          type="number"
          min={100}
          step={1000}
          value={data.maxFaces}
          aria-label="Max faces"
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange({ maxFaces: Math.max(100, Math.round(n)) });
          }}
        />
      </div>
    )}
  </>
);
