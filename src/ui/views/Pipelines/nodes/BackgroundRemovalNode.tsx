import React from 'react';
import type { BackgroundRemovalData } from '../../../../core/pipeline';
import { Form } from '../../../components';
import type { NodeBodyProps } from './types';

export const BackgroundRemovalNode: React.FC<NodeBodyProps<BackgroundRemovalData>> = ({ data, onChange }) => (
  <>
    <div className="pipe-field row">
      <span className="pipe-field-label">Enabled</span>
      <Form.Toggle size="sm" checked={data.enabled} onChange={(enabled) => onChange({ enabled })} aria-label="Background removal enabled" />
    </div>
    <p className="pipe-note">{data.enabled ? 'Subject is cut out before conditioning.' : 'Image passes through untouched.'}</p>
  </>
);
