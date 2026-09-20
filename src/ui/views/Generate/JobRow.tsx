import React, { useEffect, useRef, useState } from 'react';
import type { GenerationJob } from '../../../core/types';
import { imageStem, isActive, jobBlocker, jobTitle } from '../../../core/jobs';
import { CancelIcon, CloseIcon, ImagePlusIcon } from '../../assets/icons';
import { dockStore } from '../../stores/dockStore';
import { generationStore } from '../../stores/generationStore';
import { ElapsedTime } from './ElapsedTime';
import { JobModifiers } from './JobModifiers';
import { JobParams } from './JobParams';
import { JobSourcePicker } from './JobSourcePicker';
import { Thumbnail } from './Thumbnail';
import { dragHasFiles, imagePathsFromDrop, pickImages } from './imageInput';
import { stageLabel } from './format';

export interface JobRowProps {
  job: GenerationJob;
  /** Place among the jobs that have not started, or -1 once it has. */
  queueIndex: number;
  queueCount: number;
  installedModelIds: ReadonlySet<string>;
  knownPipelineIds: ReadonlySet<string>;
  selected: boolean;
  onSelect: () => void;
  /** This row is the one being dragged. */
  dragging: boolean;
  /** Px to shift the row by: the drag itself, or room made for it. */
  offsetY: number;
  onGripPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onGripKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}

/**
 * One job, assembled left to right in the order the decisions are made: what
 * runs it, what it runs on, what it will be called, its settings, and the
 * edits stacked after it.
 *
 * The row is one line while it has nothing to say and grows a second when it
 * does — a blocker, a place in line, a stage. That is deliberate: a queue of
 * eight quiet drafts stays eight quiet lines, and the one row that needs
 * attention is the one that is taller.
 *
 * Everything goes dead the moment the job leaves the user's hands. Main
 * refuses an edit to a started job, so a control that still looked live would
 * be lying; the row greys wholesale rather than disabling nine things one at a
 * time and getting one of them wrong.
 */
export const JobRow: React.FC<JobRowProps> = ({
  job,
  queueIndex,
  queueCount,
  installedModelIds,
  knownPipelineIds,
  selected,
  onSelect,
  dragging,
  offsetY,
  onGripPointerDown,
  onGripKeyDown,
}) => {
  const draft = job.draft;
  const editable = job.status === 'draft' || job.status === 'queued';
  const running = isActive(job.status);
  const blocker = editable ? jobBlocker(draft, installedModelIds, knownPipelineIds) : null;
  const [over, setOver] = useState(false);

  // The name is typed locally and pushed on commit: a round trip per keystroke
  // would fight the caret, and main's normalisation would arrive mid-word.
  const [name, setName] = useState(draft.name);
  const committed = useRef(draft.name);
  useEffect(() => {
    if (draft.name !== committed.current) {
      committed.current = draft.name;
      setName(draft.name);
    }
  }, [draft.name]);

  const commitName = () => {
    const next = name.trim();
    if (next === committed.current) return;
    committed.current = next;
    void generationStore.updateJob(job.id, { name: next });
  };

  const attach = async () => {
    const [first] = await pickImages();
    if (first) void generationStore.updateJob(job.id, { imagePath: first });
  };

  const status = (): React.ReactNode => {
    if (blocker) {
      return (
        <span className={blocker.field === 'image' ? '' : 'is-warn'}>
          {blocker.message}
          {blocker.field === 'model' && (
            <>
              {' · '}
              <button type="button" className="gen-link" onClick={() => dockStore.setActiveItem('models')}>
                Open Models
              </button>
            </>
          )}
        </span>
      );
    }
    if (job.status === 'queued') return `Waiting · ${queueIndex + 1} of ${queueCount}`;
    if (running) {
      const stage = stageLabel(job.progress.stage) || (job.status === 'loading' ? 'Getting the model ready' : 'Working');
      return job.progress.message ? `${stage} · ${job.progress.message}` : stage;
    }
    return null;
  };

  const line = status();

  return (
    <li
      data-job={job.id}
      className={`gen-row gen-row-${job.status} ${selected ? 'is-selected' : ''} ${dragging ? 'is-dragging' : ''} ${
        over ? 'is-over' : ''
      }`}
      style={offsetY ? { transform: `translateY(${offsetY}px)` } : undefined}
      onPointerDown={onSelect}
      onDragOver={(event) => {
        if (!editable || !dragHasFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        if (!editable || !dragHasFiles(event)) return;
        // Dropping onto a row means "this job's image", not "another job".
        event.preventDefault();
        event.stopPropagation();
        setOver(false);
        const [first] = imagePathsFromDrop(event);
        if (first) void generationStore.updateJob(job.id, { imagePath: first });
      }}
    >
      <div className="gen-row-main">
        {running && (
          <div
            className="gen-row-fill"
            style={{ width: `${Math.max(0, Math.min(100, job.progress.pct))}%` }}
            aria-hidden="true"
          />
        )}

        <button
          type="button"
          className="gen-grip"
          disabled={!editable}
          aria-label={`Reorder ${jobTitle(draft)}. Hold Alt and press the arrow keys to move it.`}
          onPointerDown={onGripPointerDown}
          onKeyDown={onGripKeyDown}
        >
          <span aria-hidden="true" />
        </button>

        <JobSourcePicker job={job} editable={editable} />

        {draft.imagePath ? (
          <button
            type="button"
            className="gen-row-thumb"
            disabled={!editable}
            title={draft.imagePath}
            aria-label="Change the image"
            onClick={() => void attach()}
          >
            <Thumbnail path={draft.imagePath} />
          </button>
        ) : (
          <button
            type="button"
            className="gen-row-thumb is-empty"
            disabled={!editable}
            aria-label="Add an image"
            title="Add an image, or drop one here"
            onClick={() => void attach()}
          >
            <ImagePlusIcon size={12} />
          </button>
        )}

        <input
          className="gen-name"
          value={name}
          disabled={!editable}
          spellCheck={false}
          aria-label="Name"
          placeholder={draft.imagePath ? imageStem(draft.imagePath) : 'New job'}
          onChange={(event) => setName(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              setName(committed.current);
              event.currentTarget.blur();
            }
          }}
        />

        {running && (
          <span className="gen-row-clock">
            <ElapsedTime since={job.startedAt ?? job.createdAt} title="Elapsed" />
            <span className="gen-row-pct">{Math.round(job.progress.pct)}%</span>
          </span>
        )}

        <JobParams job={job} editable={editable} />
        <JobModifiers job={job} editable={editable} />

        <button
          type="button"
          className="gen-rowbtn gen-row-drop"
          aria-label={running ? 'Stop this job' : 'Remove this job'}
          title={running ? 'Stop this job' : 'Remove it from the queue'}
          onClick={() => (running ? void generationStore.cancel(job.id) : void generationStore.remove(job.id))}
        >
          {running ? <CancelIcon size={14} /> : <CloseIcon size={14} />}
        </button>
      </div>

      {line && <p className={`gen-row-status ${blocker ? 'is-blocked' : ''}`}>{line}</p>}
    </li>
  );
};
