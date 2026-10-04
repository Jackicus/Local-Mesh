import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GenerationJob, JobRevision, MeshOp } from '../../../core/types';
import { isTerminalStatus, jobTitle } from '../../../core/jobs';
import { Button, Tooltip } from '../../components';
import { ArrowLeftIcon, ArrowRightIcon, LoaderIcon, MeshIcon } from '../../assets/icons';
import { getShortcutKeys } from '../../hooks';
import { useTopBarSlot } from '../../shell/topBarSlot';
import { useGenerationStore } from '../../stores/generationStore';
import { ProgressBar } from './ProgressBar';
import { RowPopover } from './RowPopover';
import { MESH_OP_ICONS, MeshOpOptions, hasOptions, opSummary } from './meshOpUi';
import { useViewerStore } from './viewerStore';
import { fileBaseName, formatCount, formatElapsed, stageLabel } from './format';

/**
 * Top left: what is on screen, and how it got that way.
 *
 * The selected job's name sits centred in the titlebar, where there is room
 * for it. The plate here holds its history: every step is a tile — the generated mesh first, then each edit in the order it
 * was made — strung on a timeline whose handle is the revision the viewport
 * draws and Save would write. The tiles are bare icons, so a long history still
 * fits; each names itself on hover, at once. Dragging the handle walks the
 * history; the two arrows at the left of the titlebar (and Ctrl+Z /
 * Ctrl+Shift+Z) take it one step at a time. Nothing is thrown away by moving: the steps ahead of the handle stay,
 * dimmed, until a new edit is made from further back.
 *
 * A tile opens what that step did. An edit can be changed or taken out there,
 * and every step after it is replayed on top, so the chain always reads as the
 * honest recipe for the mesh at the end of it.
 *
 * This used to be a back/forward pair on the job's queue row. It lives here
 * because the history belongs to the thing being looked at, not to the list.
 */
export const JobHeader: React.FC = () => {
  const [viewer, viewerActions] = useViewerStore();
  const [gen, generation] = useGenerationStore();

  const job = gen.jobs.find((j) => j.id === viewer.selectedJobId) ?? null;
  const history = job && job.revisions.length > 0 ? job : null;
  const editing = job?.editing ?? null;
  const slot = useTopBarSlot('start');
  const titleSlot = useTopBarSlot('center');

  const step = useCallback(
    (delta: number) => {
      if (!history || history.editing) return;
      const next = history.cursor + delta;
      if (next < 0 || next >= history.revisions.length) return;
      void generation.setCursor(history.id, next);
    },
    [history, generation]
  );

  // Undo and redo, for as long as there is a history on screen. Text fields
  // keep their own Ctrl+Z.
  useEffect(() => {
    if (!history) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (document.querySelector('.ui-modal-backdrop')) return;
      const key = event.key.toLowerCase();
      const back = key === 'z' && !event.shiftKey;
      const forward = (key === 'z' && event.shiftKey) || (key === 'y' && !event.shiftKey);
      if (!back && !forward) return;
      event.preventDefault();
      step(back ? -1 : 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [history, step]);

  if (!viewer.loaded && !history) {
    return viewer.loading ? (
      <div className="gen-head">
        <LoadingNote path={viewer.loading} />
      </div>
    ) : null;
  }

  const name = job ? jobTitle(job.draft) : fileBaseName(viewer.loaded!.name);
  const total = history?.revisions.length ?? 0;

  return (
    <div className="gen-head">
      {history &&
        slot &&
        createPortal(
          <>
            <Tooltip content="Back one step" shortcut={getShortcutKeys('history-back')} position="bottom" align="start">
              <button
                type="button"
                className="icon-btn gen-history-btn"
                disabled={history.cursor <= 0 || editing !== null}
                aria-label="Back one step"
                onClick={() => step(-1)}
              >
                <ArrowLeftIcon size={16} />
              </button>
            </Tooltip>
            <Tooltip
              content="Forward one step"
              shortcut={getShortcutKeys('history-forward')}
              position="bottom"
              align="start"
            >
              <button
                type="button"
                className="icon-btn gen-history-btn"
                disabled={history.cursor >= total - 1 || editing !== null}
                aria-label="Forward one step"
                onClick={() => step(1)}
              >
                <ArrowRightIcon size={16} />
              </button>
            </Tooltip>
          </>,
          slot
        )}

      {titleSlot &&
        createPortal(
          <button
            type="button"
            className="gen-title"
            title={job ? 'Show this job in the queue' : viewer.loaded?.path}
            onClick={() => job && viewerActions.pingSelection()}
          >
            {name}
          </button>,
          titleSlot
        )}

      {(history || editing) && (
        <section className="gen-plate" aria-label="Edit history">
          {history && <Timeline job={history} onStep={(i) => void generation.setCursor(history.id, i)} />}

          {editing && (
            <div className="gen-plate-progress">
              <div className="gen-plate-progress-line">
                <span className="gen-popover-title">{stageLabel(editing.op)}</span>
                <span className="gen-popover-meta">{editing.message}</span>
              </div>
              <ProgressBar pct={editing.pct} indeterminate={editing.pct <= 0} />
            </div>
          )}
        </section>
      )}

      {viewer.loading && <LoadingNote path={viewer.loading} />}
    </div>
  );
};

const LoadingNote: React.FC<{ path: string }> = ({ path }) => (
  <div className="gen-scene-note">
    <LoaderIcon size={15} className="gen-spin" />
    <span>Reading {fileBaseName(path)}</span>
  </div>
);

// ---------------------------------------------------------------------------
// The timeline
// ---------------------------------------------------------------------------

interface TimelineProps {
  job: GenerationJob;
  onStep: (index: number) => void;
}

/**
 * The tiles and the rail under them. The rail is the scrubber: press anywhere
 * on it and drag, and the handle snaps to the nearest tile, moving the
 * viewport with it. Each snap asks main for that revision; the viewer drops any
 * load a later one has overtaken, so a fast drag settles on where it stopped.
 */
const Timeline: React.FC<TimelineProps> = ({ job, onStep }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [centers, setCenters] = useState<number[]>([]);
  const [drag, setDrag] = useState<number | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const count = job.revisions.length;
  const locked = job.editing !== null;
  const shown = Math.min(drag ?? job.cursor, count - 1);

  // Measured from the rail, not offsetLeft: each tile sits in its own
  // positioned <li>, which would make every offset zero.
  const measure = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    const origin = rail.getBoundingClientRect().left;
    setCenters(
      tileRefs.current.slice(0, count).map((tile) => {
        if (!tile) return 0;
        const r = tile.getBoundingClientRect();
        return r.left - origin + r.width / 2;
      })
    );
  }, [count]);

  useLayoutEffect(measure, [measure, job.revisions]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    return () => observer.disconnect();
  }, [measure]);

  // Keep the handle's tile in view. Set by hand rather than scrollIntoView,
  // which would also scroll the clipped view the plate floats in.
  useEffect(() => {
    const scroller = scrollRef.current;
    const tile = tileRefs.current[shown];
    if (!scroller || !tile) return;
    const offset = tile.getBoundingClientRect().left - scroller.getBoundingClientRect().left + scroller.scrollLeft;
    const left = offset - 8;
    const right = offset + tile.offsetWidth + 8 - scroller.clientWidth;
    if (scroller.scrollLeft > left) scroller.scrollLeft = left;
    else if (scroller.scrollLeft < right) scroller.scrollLeft = right;
  }, [shown, count]);

  // A wheel is vertical for most mice; the strip only scrolls sideways.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if (scroller.scrollWidth <= scroller.clientWidth) return;
      event.preventDefault();
      scroller.scrollLeft += event.deltaY;
    };
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => scroller.removeEventListener('wheel', onWheel);
  }, []);

  // A step that no longer exists cannot stay open.
  useEffect(() => {
    if (openIndex !== null && openIndex >= count) setOpenIndex(null);
  }, [openIndex, count]);

  const nearest = (clientX: number): number => {
    const rail = railRef.current;
    if (!rail || centers.length === 0) return job.cursor;
    const x = clientX - rail.getBoundingClientRect().left;
    let best = 0;
    centers.forEach((c, i) => {
      if (Math.abs(c - x) < Math.abs(centers[best]! - x)) best = i;
    });
    return best;
  };

  const go = (index: number) => {
    const next = Math.max(0, Math.min(count - 1, index));
    if (next !== job.cursor) onStep(next);
    return next;
  };

  const onTrackDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (locked || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setOpenIndex(null);
    setDrag(go(nearest(event.clientX)));
  };

  const onTrackMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag === null) return;
    const next = nearest(event.clientX);
    if (next !== drag) setDrag(go(next));
  };

  const endDrag = () => setDrag(null);

  const onTrackKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (locked) return;
    const moves: Record<string, number> = {
      ArrowLeft: job.cursor - 1,
      ArrowDown: job.cursor - 1,
      ArrowRight: job.cursor + 1,
      ArrowUp: job.cursor + 1,
      Home: 0,
      End: count - 1,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    go(moves[event.key]!);
  };

  const first = centers[0] ?? 0;
  const last = centers[count - 1] ?? first;
  const at = centers[shown] ?? first;
  const current = job.revisions[shown];

  return (
    <div className="gen-timeline" ref={scrollRef}>
      <div className="gen-timeline-rail" ref={railRef}>
        <ol className="gen-timeline-tiles">
          {job.revisions.map((revision, i) => (
            <li key={`${i}-${revision.path}`}>
              {/* Straight away, not after the usual pause: the icon alone is
                    a guess, and scanning a row of them is reading. */}
              <Tooltip
                content={`${i + 1} · ${revision.op ? opSummary(revision.op) : 'Generated'} · ${formatCount(revision.faces)} faces`}
                position="top"
                delay={0}
                portal
                disabled={openIndex === i || drag !== null}
              >
                <button
                  type="button"
                  ref={(el) => {
                    tileRefs.current[i] = el;
                  }}
                  className={`gen-tile ${i === shown ? 'is-current' : ''} ${i > shown ? 'is-ahead' : ''} ${
                    openIndex === i ? 'is-open' : ''
                  }`}
                  disabled={locked}
                  aria-label={`Step ${i + 1}: ${revision.op ? opSummary(revision.op) : 'Generated'}`}
                  aria-current={i === shown ? 'step' : undefined}
                  aria-expanded={openIndex === i}
                  onClick={() => {
                    go(i);
                    setOpenIndex((prev) => (prev === i ? null : i));
                  }}
                >
                  {revision.op ? MESH_OP_ICONS[revision.op.op] : <MeshIcon size={14} />}
                </button>
              </Tooltip>
            </li>
          ))}
        </ol>

        <div
          className={`gen-track ${drag !== null ? 'is-dragging' : ''}`}
          role="slider"
          tabIndex={locked ? -1 : 0}
          aria-label="Edit history"
          aria-disabled={locked}
          aria-valuemin={1}
          aria-valuemax={count}
          aria-valuenow={shown + 1}
          aria-valuetext={`Step ${shown + 1} of ${count}: ${current?.op ? opSummary(current.op) : 'Generated'}`}
          onPointerDown={onTrackDown}
          onPointerMove={onTrackMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onTrackKey}
        >
          <span className="gen-track-line" style={{ left: first, width: Math.max(0, last - first) }} />
          <span className="gen-track-fill" style={{ left: first, width: Math.max(0, at - first) }} />
          {centers.map((c, i) => (
            <span key={i} className={`gen-track-tick ${i <= shown ? 'is-past' : ''}`} style={{ left: c }} />
          ))}
          {count > 0 && <span className="gen-track-thumb" style={{ left: at }} />}
        </div>
      </div>

      {openIndex !== null && job.revisions[openIndex] && (
        <RowPopover
          open
          anchor={tileRefs.current[openIndex] ?? null}
          onClose={() => setOpenIndex(null)}
          label={`Step ${openIndex + 1}`}
          width={248}
        >
          <StepDetails
            key={`${openIndex}-${job.revisions[openIndex]!.path}`}
            job={job}
            index={openIndex}
            onDone={() => setOpenIndex(null)}
          />
        </RowPopover>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// One step, opened
// ---------------------------------------------------------------------------

interface StepDetailsProps {
  job: GenerationJob;
  index: number;
  onDone: () => void;
}

/**
 * What a step did, and — for an edit — the same controls it was made with, so
 * changing it is the gesture that made it. Applying replays the steps after
 * it; the line above the buttons says how many, because that is the cost.
 */
const StepDetails: React.FC<StepDetailsProps> = ({ job, index, onDone }) => {
  const [gen, generation] = useGenerationStore();
  const revision = job.revisions[index] as JobRevision;
  const [op, setOp] = useState<MeshOp | null>(revision.op);

  const later = job.revisions.length - 1 - index;
  const input = job.revisions[index - 1];
  const queueBusy = gen.jobs.some((j) => j.status === 'running' || j.status === 'loading');
  const reason = !isTerminalStatus(job.status)
    ? 'This job has not finished'
    : queueBusy
      ? 'Wait for the queue to finish to change a step'
      : gen.processing || job.editing
        ? 'Another edit is running'
        : later > 0 && job.revisions.slice(index + 1).some((r) => r.op === null)
          ? 'A later step cannot be replayed'
          : null;

  const stats = (
    <div className="gen-popover-meta">
      <span>{formatCount(revision.vertices)} verts</span>
      <span>{formatCount(revision.faces)} faces</span>
    </div>
  );

  if (!revision.op || !op) {
    const took = job.finishedAt
      ? formatElapsed(job.finishedAt - (job.runningAt ?? job.startedAt ?? job.createdAt))
      : null;
    return (
      <>
        <span className="gen-popover-title">Step 1 · Generated</span>
        <p className="gen-step-note">
          The mesh the model made{took ? `, in ${took}` : ''}. Every step after it is an edit on top.
        </p>
        {stats}
      </>
    );
  }

  const changed = JSON.stringify(op) !== JSON.stringify(revision.op);
  const replay = later > 0 ? ` and redoes the ${later === 1 ? 'step' : `${later} steps`} after it` : '';

  const revise = async (next: MeshOp | null) => {
    onDone();
    await generation.reviseEdit(job.id, index, next);
  };

  return (
    <>
      <span className="gen-popover-title">
        Step {index + 1} · {opSummary(revision.op)}
      </span>
      {stats}
      {hasOptions(op) && (
        <div className="gen-step-options">
          <MeshOpOptions op={op} faces={input?.faces ?? 0} onChange={setOp} />
        </div>
      )}
      {reason ? (
        <p className="gen-step-note">{reason}</p>
      ) : hasOptions(op) ? (
        <p className="gen-step-note">Changing it rebuilds this step{replay}.</p>
      ) : later > 0 ? (
        <p className="gen-step-note">Removing it redoes the {later === 1 ? 'step' : `${later} steps`} after it.</p>
      ) : null}
      <div className="gen-step-actions">
        <Button variant="subtle" size="sm" disabled={reason !== null} onClick={() => void revise(null)}>
          Remove
        </Button>
        {hasOptions(op) && (
          <Button variant="primary" size="sm" disabled={reason !== null || !changed} onClick={() => void revise(op)}>
            Apply change
          </Button>
        )}
      </div>
    </>
  );
};
