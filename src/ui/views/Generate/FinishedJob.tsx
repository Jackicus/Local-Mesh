import React, { useEffect, useRef, useState } from 'react';
import type { GenerationJob } from '../../../core/types';
import { MESH_OP_DEFINITIONS } from '../../../core/types';
import { currentRevision } from '../../../core/generation';
import { imageStem, jobTitle } from '../../../core/jobs';
import { toast } from '../../components';
import {
  AlertCircleIcon,
  CancelIcon,
  CheckIcon,
  ChevronDownIcon,
  DownloadIcon,
  LoaderIcon,
  RefreshIcon,
  TrashIcon,
} from '../../assets/icons';
import { generationStore } from '../../stores/generationStore';
import { Thumbnail } from './Thumbnail';
import { formatCount, formatElapsed } from './format';

export interface FinishedJobProps {
  job: GenerationJob;
  selected: boolean;
  onSelect: () => void;
}

/**
 * A job that has stopped running, on the shelf above the work still to come.
 *
 * Its four controls are back, forward, save and delete, and the first two are
 * the reason the cache exists: twenty passes of fine editing cost one output
 * file, not twenty. Chevrons alone would be two mysteries, so the readout
 * between them names the revision — what made it, and where it sits in the
 * chain — which is also how the modifier chips on a draft read once they have
 * actually run.
 *
 * Save is the only thing that writes into the outputs folder, and it ends the
 * job: the mesh is kept, the cache goes, the row leaves. Delete ends it
 * without keeping anything. A job that is neither stays, across restarts, so
 * unfinished work survives closing the app.
 */
export const FinishedJob: React.FC<FinishedJobProps> = ({ job, selected, onSelect }) => {
  const draft = job.draft;
  const revision = currentRevision(job);
  const total = job.revisions.length;
  const failed = job.status === 'failed' || job.status === 'cancelled';
  const editing = job.editing !== null;

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

  /**
   * Re-run a job that failed. There is no way to restart a job in place —
   * main refuses to edit anything that has started — so this stands a fresh
   * draft up with the same everything and retires the old row.
   */
  const again = async () => {
    if (!draft.imagePath) return;
    const [id] = await generationStore.addJobs([draft.imagePath]);
    if (!id) return;
    await generationStore.updateJob(id, {
      source: draft.source,
      name: draft.name,
      modifiers: draft.modifiers,
      format: draft.format,
    });
    void generationStore.remove(job.id);
  };

  const save = async () => {
    const path = await generationStore.save(job.id);
    if (path) toast.success(`Saved ${path.split(/[\\/]/).pop()}`);
  };

  const step = (delta: number) => void generationStore.setCursor(job.id, job.cursor + delta);

  const revisionLabel = revision
    ? revision.op
      ? MESH_OP_DEFINITIONS[revision.op.op].short
      : 'Generated'
    : '—';

  return (
    <li
      data-job={job.id}
      className={`gen-done gen-done-${job.status} ${selected ? 'is-selected' : ''}`}
      onPointerDown={onSelect}
    >
      <span className={`gen-done-glyph ${failed ? 'is-fault' : ''}`} aria-hidden="true">
        {editing ? <LoaderIcon size={13} className="gen-spin" /> : failed ? <AlertCircleIcon size={13} /> : <CheckIcon size={13} />}
      </span>

      {draft.imagePath ? <Thumbnail path={draft.imagePath} /> : <span className="gen-thumb gen-thumb-xs is-empty" />}

      <input
        className="gen-name"
        value={name}
        spellCheck={false}
        aria-label="Name"
        placeholder={draft.imagePath ? imageStem(draft.imagePath) : 'Mesh'}
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

      {failed ? (
        <>
          <span className="gen-done-fault" title={job.error}>
            {job.error ?? (job.status === 'cancelled' ? 'Stopped' : 'Failed')}
          </span>
          <button
            type="button"
            className="gen-rowbtn"
            disabled={!draft.imagePath}
            aria-label="Try this job again"
            title="Try again"
            onClick={() => void again()}
          >
            <RefreshIcon size={14} />
          </button>
        </>
      ) : (
        <span className="gen-steps" role="group" aria-label="Revision">
          <button
            type="button"
            className="gen-step"
            disabled={job.cursor <= 0 || editing}
            aria-label="Back one edit"
            title="Back one edit"
            onClick={() => step(-1)}
          >
            <ChevronDownIcon size={13} className="gen-step-left" />
          </button>
          <span className="gen-steps-read">
            <span className="gen-steps-op">{revisionLabel}</span>
            <span className="gen-steps-count">
              {total > 0 ? `${job.cursor + 1} of ${total}` : '—'}
            </span>
          </span>
          <button
            type="button"
            className="gen-step"
            disabled={job.cursor >= total - 1 || editing}
            aria-label="Forward one edit"
            title="Forward one edit"
            onClick={() => step(1)}
          >
            <ChevronDownIcon size={13} className="gen-step-right" />
          </button>
        </span>
      )}

      {revision && (
        <span className="gen-done-stats" title={`${formatCount(revision.vertices)} vertices`}>
          {formatCount(revision.faces)} faces
          {job.finishedAt ? ` · ${formatElapsed(job.finishedAt - (job.startedAt ?? job.createdAt))}` : ''}
        </span>
      )}

      {!failed && (
        <button
          type="button"
          className="gen-rowbtn gen-done-save"
          disabled={!revision || editing}
          aria-label={`Save ${jobTitle(draft)}`}
          title="Save it into the outputs folder"
          onClick={() => void save()}
        >
          <DownloadIcon size={14} />
        </button>
      )}

      <button
        type="button"
        className="gen-rowbtn gen-row-drop"
        aria-label={`Delete ${jobTitle(draft)}`}
        title={failed ? 'Delete this job' : 'Delete it without saving'}
        onClick={() => void generationStore.remove(job.id)}
      >
        {failed ? <CancelIcon size={14} /> : <TrashIcon size={14} />}
      </button>
    </li>
  );
};
