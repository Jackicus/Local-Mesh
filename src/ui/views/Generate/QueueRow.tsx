import React from 'react';
import type { GenerationJob, JobStatus } from '../../../core/types';
import type { BadgeProps } from '../../components';
import { Badge, Button, Tooltip } from '../../components';
import { CancelIcon, EyeIcon, FolderOpenIcon } from '../../assets/icons';
import { api } from '../../stores/createStore';
import { generationStore } from '../../stores/generationStore';
import { getModel } from '../../../core/models';
import { Thumbnail } from './Thumbnail';
import { ProgressBar } from './ProgressBar';
import { formatElapsed } from './format';
import { ElapsedTime } from './ElapsedTime';
import { viewerStore } from './viewerStore';

const STATUS_TONE: Record<JobStatus, NonNullable<BadgeProps['variant']>> = {
  queued: 'neutral',
  loading: 'warning',
  running: 'accent',
  done: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

function startOf(job: GenerationJob): number {
  return job.startedAt ?? job.createdAt;
}

/** Total, plus a load/generate split when the job had to load the model first. */
function elapsed(job: GenerationJob): string | null {
  if (!job.finishedAt) return null;
  const total = formatElapsed(job.finishedAt - startOf(job));
  if (!job.runningAt || job.runningAt - startOf(job) < 1000) return total;
  return `${total} (load ${formatElapsed(job.runningAt - startOf(job))} · gen ${formatElapsed(job.finishedAt - job.runningAt)})`;
}

export const QueueRow: React.FC<{ job: GenerationJob }> = ({ job }) => {
  const active = job.status === 'running' || job.status === 'loading';
  const canCancel = active || job.status === 'queued';
  const duration = elapsed(job);

  return (
    <li className="gen-job">
      <Thumbnail path={job.imagePath} size="sm" />

      <div className="gen-job-body">
        <div className="gen-job-line">
          <span className="gen-job-name" title={job.imagePath}>
            {job.imageName}
          </span>
          <Badge variant={STATUS_TONE[job.status]}>{job.status}</Badge>
        </div>

        <div className="gen-job-line gen-job-sub">
          <span className="gen-job-model">{getModel(job.modelId)?.name ?? job.modelId}</span>
          {active ? (
            <ElapsedTime since={startOf(job)} className="gen-job-time" title="Elapsed" />
          ) : (
            duration && <span className="gen-job-time">{duration}</span>
          )}
        </div>

        {active && (
          <div className="gen-job-progress">
            <ProgressBar pct={job.progress.pct} indeterminate={job.status === 'loading'} />
            <div className="gen-job-line gen-job-sub">
              <span>{job.progress.stage || job.status}</span>
              <span>{Math.round(job.progress.pct)}%</span>
            </div>
          </div>
        )}

        {job.error && (
          <p className="gen-job-error" title={job.error}>
            {job.error}
          </p>
        )}

        <div className="gen-job-actions">
          {canCancel && (
            <Button
              variant="subtle"
              size="sm"
              icon={<CancelIcon size={13} />}
              onClick={() => generationStore.cancel(job.id)}
            >
              Cancel
            </Button>
          )}
          {job.status === 'done' && job.outputPath && (
            <>
              <Button
                variant="subtle"
                size="sm"
                icon={<EyeIcon size={13} />}
                onClick={() => void viewerStore.load(job.outputPath!)}
              >
                View
              </Button>
              <Tooltip content="Show in folder" position="top">
                <Button
                  variant="subtle"
                  size="sm"
                  className="btn-icon-only"
                  aria-label="Show in folder"
                  icon={<FolderOpenIcon size={13} />}
                  onClick={() => api()?.showItemInFolder(job.outputPath!)}
                />
              </Tooltip>
            </>
          )}
        </div>
      </div>
    </li>
  );
};
