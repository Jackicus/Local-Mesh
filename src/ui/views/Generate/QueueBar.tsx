import React from 'react';
import type { GenerationJob } from '../../../core/types';
import { Button } from '../../components';
import {
  AlertCircleIcon,
  CancelIcon,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  EyeIcon,
  FolderOpenIcon,
  GripVerticalIcon,
  LoaderIcon,
} from '../../assets/icons';
import { api } from '../../stores/createStore';
import { generationStore } from '../../stores/generationStore';
import { ElapsedTime } from './ElapsedTime';
import { PipelinePanel, PipelineTag } from './PipelineTag';
import { Thumbnail } from './Thumbnail';
import { formatCount, formatElapsed, stageLabel } from './format';
import { viewerStore } from './viewerStore';

const FINISHED = new Set(['done', 'failed', 'cancelled']);

/** Which door into the bar's panel is open. */
export type BarPanel = 'detail' | 'pipeline' | null;

function startOf(job: GenerationJob): number {
  return job.startedAt ?? job.createdAt;
}

/** Total, plus a load/generate split when the job had to load the model first. */
function duration(job: GenerationJob): string | null {
  if (!job.finishedAt) return null;
  const total = formatElapsed(job.finishedAt - startOf(job));
  if (!job.runningAt || job.runningAt - startOf(job) < 1000) return total;
  return `${total} (load ${formatElapsed(job.runningAt - startOf(job))} · gen ${formatElapsed(job.finishedAt - job.runningAt)})`;
}

export interface QueueBarProps {
  job: GenerationJob;
  /** Place in line, or -1 once it has left the queue. */
  queuedIndex: number;
  queuedCount: number;
  panel: BarPanel;
  onPanel: (panel: Exclude<BarPanel, null>) => void;
  onClosePanel: () => void;
  /** This bar is the one being dragged. */
  dragging: boolean;
  /** Px to shift the bar by: the drag itself, or room made for it. */
  offsetY: number;
  onGripPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onGripKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}

/**
 * One job as one progress bar: the fill is the bar's own ground, the rail at
 * its left edge carries the status colour, and the three controls the work
 * needs — pipeline, detail, stop — sit on the right. Queued bars get a fourth,
 * the grip, because the drag has to start somewhere that isn't a button.
 */
export const QueueBar: React.FC<QueueBarProps> = ({
  job,
  queuedIndex,
  queuedCount,
  panel,
  onPanel,
  onClosePanel,
  dragging,
  offsetY,
  onGripPointerDown,
  onGripKeyDown,
}) => {
  const active = job.status === 'running' || job.status === 'loading';
  const queued = job.status === 'queued';
  const finished = FINISHED.has(job.status);
  // The fill is work in flight; a finished bar says so with its rail and glyph
  // rather than staying washed in colour.
  const pct = active ? job.progress.pct : 0;
  const total = duration(job);

  const detail = (): string => {
    if (queued) return `Queued · ${queuedIndex + 1} of ${queuedCount}`;
    if (active) {
      const stage = stageLabel(job.progress.stage) || (job.status === 'loading' ? 'Loading model' : 'Running');
      return job.progress.message ? `${stage} · ${job.progress.message}` : stage;
    }
    if (job.status === 'failed') return job.error ?? 'Failed';
    if (job.status === 'cancelled') return 'Cancelled';
    return total ? `Done · ${total}` : 'Done';
  };

  return (
    <li
      data-job={job.id}
      className={`gen-qbar gen-qbar-${job.status} ${dragging ? 'is-dragging' : ''} ${panel ? 'is-expanded' : ''}`}
      style={offsetY ? { transform: `translateY(${offsetY}px)` } : undefined}
    >
      <div className="gen-qbar-row">
        <div className="gen-qbar-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} aria-hidden="true" />

        {queued ? (
          <button
            type="button"
            className="gen-qbar-grip"
            aria-label={`Reorder ${job.imageName}. Hold Alt and press the arrow keys to move it.`}
            onPointerDown={onGripPointerDown}
            onKeyDown={onGripKeyDown}
          >
            <GripVerticalIcon size={14} />
          </button>
        ) : (
          <span className="gen-qbar-glyph" aria-hidden="true">
            {active ? (
              <LoaderIcon size={13} className="gen-spin" />
            ) : job.status === 'done' ? (
              <CheckIcon size={13} />
            ) : job.status === 'failed' ? (
              <AlertCircleIcon size={13} />
            ) : (
              <CancelIcon size={13} />
            )}
          </span>
        )}

        <Thumbnail path={job.imagePath} size="xs" />

        <div className="gen-qbar-body">
          <span className="gen-qbar-name" title={job.imagePath}>
            {job.imageName}
          </span>
          <span className={`gen-qbar-detail ${job.status === 'failed' ? 'is-error' : ''}`}>{detail()}</span>
        </div>

        <span className="gen-qbar-clock">
          {active ? (
            <>
              <ElapsedTime since={startOf(job)} title="Elapsed" />
              <span className="gen-qbar-pct">{Math.round(job.progress.pct)}%</span>
            </>
          ) : (
            finished &&
            job.finishedAt && <span className="gen-qbar-pct">{formatElapsed(job.finishedAt - startOf(job))}</span>
          )}
        </span>

        <PipelineTag job={job} open={panel === 'pipeline'} onToggle={() => onPanel('pipeline')} />

        <button
          type="button"
          className={`gen-qbar-btn ${panel === 'detail' ? 'is-active' : ''}`}
          aria-expanded={panel === 'detail'}
          aria-label={panel === 'detail' ? `Hide details for ${job.imageName}` : `Show details for ${job.imageName}`}
          onClick={() => onPanel('detail')}
        >
          <ChevronDownIcon size={14} className={`gen-chevron ${panel === 'detail' ? 'is-open' : ''}`} />
        </button>

        {finished ? (
          <button
            type="button"
            className="gen-qbar-btn gen-qbar-stop"
            aria-label={`Remove ${job.imageName} from the queue`}
            title="Remove from the queue"
            onClick={() => void generationStore.dismiss(job.id)}
          >
            <CloseIcon size={14} />
          </button>
        ) : (
          <button
            type="button"
            className="gen-qbar-btn gen-qbar-stop"
            aria-label={`Cancel ${job.imageName}`}
            title="Cancel this job"
            onClick={() => void generationStore.cancel(job.id)}
          >
            <CancelIcon size={14} />
          </button>
        )}
      </div>

      {panel === 'pipeline' && (
        <div className="gen-qbar-panel">
          <PipelinePanel job={job} queuedIndex={queuedIndex} onDone={onClosePanel} />
        </div>
      )}

      {panel === 'detail' && (
        <div className="gen-qbar-panel gen-qbar-detail-panel">
          <Thumbnail path={job.imagePath} size="md" />
          <div className="gen-qbar-facts">
            <p className="gen-qbar-path" title={job.imagePath}>
              {job.imagePath}
            </p>
            <p className="gen-qbar-fact">
              {job.pipelineName}
              {total ? ` · ${total}` : ''}
            </p>
            {job.stats && (
              <p className="gen-qbar-fact">
                {formatCount(job.stats.vertices)} verts · {formatCount(job.stats.faces)} faces
              </p>
            )}
            {job.error && <p className="gen-qbar-fault">{job.error}</p>}
            {job.status === 'done' && job.outputPath && (
              <div className="ui-btn-row">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<EyeIcon size={13} />}
                  onClick={() => void viewerStore.load(job.outputPath!)}
                >
                  View
                </Button>
                <Button
                  variant="subtle"
                  size="sm"
                  icon={<FolderOpenIcon size={13} />}
                  onClick={() => void api()?.showItemInFolder(job.outputPath!)}
                >
                  Folder
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </li>
  );
};
