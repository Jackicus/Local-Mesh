import React, { useCallback, useEffect, useState } from 'react';
import type { MeshOp, MeshOpKind } from '../../../core/types';
import { MESH_OP_DEFINITIONS, MESH_OP_KINDS } from '../../../core/types';
import { currentRevision } from '../../../core/generation';
import { isTerminalStatus, jobTitle } from '../../../core/jobs';
import { Button } from '../../components';
import { ChevronDownIcon, LoaderIcon } from '../../assets/icons';
import { useGenerationStore } from '../../stores/generationStore';
import { ProgressBar } from './ProgressBar';
import { MESH_OP_ICONS, MeshOpOptions, defaultOp, hasOptions } from './meshOpUi';
import { useViewerStore } from './viewerStore';
import { formatCount, stageLabel } from './format';

const initialOps = (): Record<MeshOpKind, MeshOp> =>
  Object.fromEntries(MESH_OP_KINDS.map((kind) => [kind, defaultOp(kind, 'tool')])) as Record<MeshOpKind, MeshOp>;

/**
 * The same six edits a job can carry as modifiers, applied one at a time to a
 * job that has already run.
 *
 * The plate acts on the *selected job*, not on "whatever is in the viewport".
 * Those used to be different things — the viewer could be pointed at any file
 * on disk and the tools would write a sibling next to it — which meant the
 * edits and the queue kept two separate ideas of what you were working on. A
 * job owns its mesh and its revisions now, so an edit here is a revision
 * there, and the timeline under the mesh's name is the undo this panel used to
 * have.
 *
 * A job that has not run yet is not editable here on purpose: its edits belong
 * on the row, where they run as part of the job instead of costing a second
 * pass over the mesh.
 */
export const MeshTools: React.FC = () => {
  const [viewer] = useViewerStore();
  const [gen, generation] = useGenerationStore();
  const [open, setOpen] = useState<MeshOpKind | null>(null);
  const [ops, setOps] = useState<Record<MeshOpKind, MeshOp>>(initialOps);

  const job = gen.jobs.find((j) => j.id === viewer.selectedJobId) ?? null;
  const revision = job ? currentRevision(job) : null;
  const queueBusy = gen.jobs.some((j) => j.status === 'running' || j.status === 'loading');
  const processing = gen.processing;
  const running = processing !== null || job?.editing != null;

  const reason = !job
    ? 'Pick a finished job to edit it'
    : !isTerminalStatus(job.status)
      ? 'This job has not run yet — stack the edit on its row instead'
      : !revision
        ? 'This job produced no mesh'
        : queueBusy
          ? 'Wait for the queue to finish'
          : null;
  const blocked = reason !== null || running;

  useEffect(() => {
    if (blocked) setOpen(null);
  }, [blocked]);

  const patch = useCallback(
    (kind: MeshOpKind, op: MeshOp) => setOps((prev) => ({ ...prev, [kind]: op })),
    []
  );

  const apply = useCallback(
    async (kind: MeshOpKind) => {
      if (!job || blocked) return;
      setOpen(null);
      await generation.applyEdit(job.id, ops[kind]);
    },
    [job, blocked, ops, generation]
  );

  const faces = revision?.faces ?? 0;

  return (
    <div className="gen-edit">
      <header className="gen-panel-head">
        <span className="gen-panel-title">Edit</span>
        {revision && <span className="gen-panel-meta">{formatCount(faces)} faces</span>}
      </header>

      {job && !reason && (
        <p className="gen-edit-subject">
          {jobTitle(job.draft)}
          <span className="gen-edit-subject-step">
            step {job.cursor + 1} of {job.revisions.length}
          </span>
        </p>
      )}

      {reason && <p className="gen-edit-reason">{reason}</p>}

      {running && (
        <div className="gen-edit-progress">
          <div className="gen-edit-progress-line">
            <span className="gen-popover-title">
              {processing ? stageLabel(processing.stage) : job?.editing ? stageLabel(job.editing.op) : 'Working'}
            </span>
            {processing && <span className="gen-row-pct">{Math.round(processing.pct)}%</span>}
          </div>
          <ProgressBar pct={processing?.pct ?? 0} indeterminate={!processing} />
        </div>
      )}

      <ul className="gen-edit-ops">
        {MESH_OP_KINDS.map((kind) => {
          const def = MESH_OP_DEFINITIONS[kind];
          const op = ops[kind];
          const expandable = hasOptions(op);
          const isOpen = open === kind;
          return (
            <li key={kind} className={`gen-edit-item ${isOpen ? 'is-open' : ''}`}>
              <button
                type="button"
                className="gen-edit-op"
                disabled={blocked}
                title={def.description}
                aria-expanded={expandable ? isOpen : undefined}
                onClick={() => (expandable ? setOpen((prev) => (prev === kind ? null : kind)) : void apply(kind))}
              >
                <span className="gen-edit-op-icon">
                  {job?.editing?.op === kind ? <LoaderIcon size={14} className="gen-spin" /> : MESH_OP_ICONS[kind]}
                </span>
                <span className="gen-edit-op-label">{def.short}</span>
                {expandable && <ChevronDownIcon size={13} className={`gen-chevron ${isOpen ? 'is-open' : ''}`} />}
              </button>

              {expandable && isOpen && (
                <div className="gen-edit-options">
                  <MeshOpOptions op={op} faces={faces} onChange={(next) => patch(kind, next)} />
                  <Button variant="primary" size="sm" fullWidth onClick={() => void apply(kind)}>
                    Apply {def.short}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="gen-edit-foot">
        Every edit adds a step to the timeline under the mesh&apos;s name, where you can walk it back or change it.
        Nothing is written to disk until you save it.
      </p>
    </div>
  );
};
