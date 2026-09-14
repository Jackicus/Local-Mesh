import React from 'react';
import type { MeshExportData } from '../../../../core/pipeline';
import type { ExportFormat } from '../../../../core/generation';
import { Form } from '../../../components';
import type { NodeBodyProps } from './types';

const FORMATS: ExportFormat[] = ['glb', 'obj', 'stl', 'ply'];
const TOKENS = ['{image}', '{model}', '{pipeline}', '{date}', '{time}', '{seed}', '{n}'];

export const MeshExportNode: React.FC<NodeBodyProps<MeshExportData>> = ({ data, onChange }) => (
  <>
    <div className="pipe-field">
      <span className="pipe-field-label">Format</span>
      <Form.Segmented<ExportFormat>
        size="sm"
        fullWidth
        options={FORMATS.map((f) => ({ value: f, label: f.toUpperCase() }))}
        value={data.format}
        onChange={(format) => onChange({ format })}
      />
    </div>
    <div className="pipe-field">
      <span className="pipe-field-label">File name</span>
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
