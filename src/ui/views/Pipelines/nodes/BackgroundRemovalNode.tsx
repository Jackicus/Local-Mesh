import React from 'react';
import type { BackgroundRemovalData } from '../../../../core/pipeline';
import { Form } from '../../../components';
import { FieldLabel } from '../InfoTip';
import type { NodeBodyProps } from './types';

export const BackgroundRemovalNode: React.FC<NodeBodyProps<BackgroundRemovalData>> = ({ data, onChange }) => (
  <>
    <div className="pipe-field row">
      <FieldLabel
        label="Enabled"
        info="Runs a small matting model on the CPU (about a second) to cut the subject out. Images that already carry a transparent cut-out skip it. Off is only right for art that is already on a clean background."
      />
      <Form.Toggle size="sm" checked={data.enabled} onChange={(enabled) => onChange({ enabled })} aria-label="Background removal enabled" />
    </div>
    <p className="pipe-note">{data.enabled ? 'Subject is cut out before conditioning.' : 'Image passes through untouched.'}</p>
  </>
);
