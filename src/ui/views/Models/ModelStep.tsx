import React from 'react';
import type { ModelDownloadProgress } from '../../../core/types';
import { Badge, Button } from '../../components';
import { CancelIcon } from '../../assets/icons';
import { formatBytes } from './formatBytes';
import { ProgressBar } from './ProgressBar';

export interface StepBadge {
  variant: 'accent' | 'neutral' | 'success' | 'warning' | 'danger';
  label: string;
}

interface ModelStepProps {
  /** "1" / "2" — the step's position in the install flow. */
  index: number;
  label: string;
  badge: StepBadge;
  /** Size on disk, shown next to the badge when there is anything to report. */
  aside?: string;
  /** The step's own button; omitted for built-in models. */
  action?: React.ReactNode;
  /** Live progress, only when it belongs to this step (`kind` matched by the caller). */
  progress?: ModelDownloadProgress;
  onCancel: () => void;
  /** What the step does — a hover tooltip on the row, not a visible line. */
  note?: string;
}

/** Human text for the running line: bytes for weights, the pip line for deps. */
function progressText(d: ModelDownloadProgress): string {
  switch (d.status) {
    case 'starting':
      return 'Starting…';
    case 'done':
      return 'Done';
    case 'failed':
      return d.error ?? 'Failed';
    case 'cancelled':
      return 'Cancelled';
    default:
      if (d.kind === 'weights') {
        const bytes = `${formatBytes(d.downloadedBytes)} / ${formatBytes(d.totalBytes)}`;
        return d.message ? `${bytes} · ${d.message}` : bytes;
      }
      return d.message || 'Installing…';
  }
}

const RUNNING: ModelDownloadProgress['status'][] = ['starting', 'downloading', 'installing-deps'];

/** One line of the install ledger: step, state, size, action — progress unfurls below it. */
export const ModelStep: React.FC<ModelStepProps> = ({
  index,
  label,
  badge,
  aside,
  action,
  progress,
  onCancel,
  note,
}) => {
  const running = Boolean(progress && RUNNING.includes(progress.status));
  const failed = progress?.status === 'failed';

  return (
    <div className="models-step" title={note}>
      <span className="models-step-name">
        <span className="models-step-index">{index}</span>
        {label}
      </span>
      <Badge variant={badge.variant} className="models-pill">
        {badge.label}
      </Badge>
      {aside && <span className="models-step-size">{aside}</span>}
      <span className="models-step-action">
        {running ? (
          <Button size="sm" variant="secondary" icon={<CancelIcon size={14} />} onClick={onCancel}>
            Cancel
          </Button>
        ) : (
          action
        )}
      </span>

      {progress && (running || failed) && (
        <div className="models-step-progress">
          <div className="models-download-bar">
            <ProgressBar
              pct={progress.pct}
              indeterminate={progress.status === 'starting'}
              tone={failed ? 'danger' : 'accent'}
            />
            <span className="models-download-pct">{Math.round(progress.pct)}%</span>
          </div>
          <p className={`models-download-text ${failed ? 'models-danger' : ''}`} title={progressText(progress)}>
            {progressText(progress)}
          </p>
        </div>
      )}
    </div>
  );
};
