import React from 'react';
import type { MeshExportData } from '../../../../core/pipeline';
import type { ExportFormat } from '../../../../core/generation';
import { Form } from '../../../components';
import { FieldLabel } from '../InfoTip';
import type { NodeBodyProps } from './types';

const FORMATS: ExportFormat[] = ['glb', 'obj', 'stl', 'ply'];
const TOKENS = ['{image}', '{model}', '{pipeline}', '{date}', '{time}', '{seed}', '{n}'];

export const MeshExportNode: React.FC<NodeBodyProps<MeshExportData>> = ({ data, onChange }) => (
  <>
    <div className="pipe-field">
      <FieldLabel
        label="Format"
        info={
          <>
            <span className="pipe-info-line">GLB is one self-contained binary file and the safest default — every modern viewer and engine reads it.</span>
            <span className="pipe-info-line">OBJ is plain text and read by everything old. STL is for 3D printing and keeps triangles only. PLY suits scan and point-cloud tools.</span>
          </>
        }
      />
      <Form.Segmented<ExportFormat>
        size="sm"
        fullWidth
        options={FORMATS.map((f) => ({ value: f, label: f.toUpperCase() }))}
        value={data.format}
        onChange={(format) => onChange({ format })}
      />
    </div>
    <div className="pipe-field">
      <FieldLabel
        label="File name"
        info={
          <>
            <span className="pipe-info-line">Name of the written file, minus the extension. Tokens are filled in per job:</span>
            <span className="pipe-info-line">
              {'{image}'} source file name · {'{model}'} model id · {'{pipeline}'} this pipeline · {'{date}'} YYYYMMDD · {'{time}'} HHMMSS ·{' '}
              {'{seed}'} the seed actually used · {'{n}'} position in the batch.
            </span>
          </>
        }
      />
      <Form.Input
        size="sm"
        value={data.namePattern}
        aria-label="File name pattern"
        spellCheck={false}
        onChange={(e) => onChange({ namePattern: e.target.value })}
      />
      <span className="pipe-hint">
        {TOKENS.map((t) => (
          <code key={t}>{t}</code>
        ))}
      </span>
    </div>
  </>
);
