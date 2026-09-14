import React from 'react';
import type { PipelineIssue } from '../../../core/pipeline';
import { AlertCircleIcon, AlertTriangleIcon, CheckCircleIcon } from '../../assets/icons';

export interface ValidationBarProps {
  issues: PipelineIssue[];
}

/**
 * The bottom rail: what stops this pipeline running, in the order the
 * validator found it. Silent success still says so — "Ready" is the signal
 * the Generate view will accept the graph.
 */
export const ValidationBar: React.FC<ValidationBarProps> = ({ issues }) => {
  const errors = issues.filter((i) => i.level === 'error');
  const state = errors.length > 0 ? 'error' : issues.length > 0 ? 'warning' : 'ok';

  return (
    <footer className={`pipe-validation ${state}`} role="status" aria-live="polite">
      {state === 'ok' ? (
        <span className="pipe-issue ok">
          <CheckCircleIcon size={14} />
          Ready — Generate can run this pipeline.
        </span>
      ) : (
        issues.map((issue, i) => (
          <span key={`${issue.level}-${i}`} className={`pipe-issue ${issue.level}`}>
            {issue.level === 'error' ? <AlertCircleIcon size={14} /> : <AlertTriangleIcon size={14} />}
            {issue.message}
          </span>
        ))
      )}
    </footer>
  );
};
