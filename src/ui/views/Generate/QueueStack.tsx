import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GenerationJob } from '../../../core/types';
import { isPending, isTerminalStatus, jobTitle } from '../../../core/jobs';
import { PlusIcon } from '../../assets/icons';
import { Tooltip } from '../../components';
import { useGenerationStore } from '../../stores/generationStore';
import { usePipelineStore } from '../../stores/pipelineStore';
import { FinishedJob } from './FinishedJob';
import { JobRow } from './JobRow';
import { useInstalledModelIds } from './installedModels';
import { useQueueCounts } from './queueState';
import { useViewerStore } from './viewerStore';

/** How far the pointer travels before a press on the grip becomes a drag. */
const DRAG_THRESHOLD = 4;

interface Slot {
  id: string;
  /** Viewport y of the row when the drag started. */
  top: number;
}

interface DragState {
  id: string;
  pointerId: number;
  startY: number;
  dy: number;
  from: number;
  to: number;
  slots: Slot[];
  /** False until the pointer has moved past the threshold. */
  armed: boolean;
}

/**
 * The queue, bottom left, and the whole workspace: a job is born here, edited
 * here, run from here and either kept or thrown away here.
 *
 * Two bands, split by what the user can still change. Finished work sits on a
 * shelf at the top — done with, waiting only to be saved or dropped — and
 * everything still ahead sits below it, nearest the eye and nearest the Start
 * control across the band. That is the opposite of a log, which is the point:
 * the bottom of the list is not the past, it is the next thing to happen.
 *
 * The reorder is a pointer drag with window-level listeners rather than
 * pointer capture, because a capture is tied to a button React is free to
 * re-render out from under us — which it does, on every progress push. The
 * threshold keeps a click on the grip from counting as a one-pixel drag, and
 * Alt with the arrow keys does the same job without a pointer at all.
 */
export const QueueStack: React.FC = () => {
  const [gen, generation] = useGenerationStore();
  const [viewer, viewerActions] = useViewerStore();
  const [pipelines] = usePipelineStore();
  const installedModelIds = useInstalledModelIds();
  const counts = useQueueCounts();
  const [drag, setDrag] = useState<DragState | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const rootRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const jobCount = useRef(0);

  const jobs = gen.jobs;
  // Main keeps the array in run order; that is the order to show and reorder in.
  const finished = useMemo(() => jobs.filter((j) => isTerminalStatus(j.status)), [jobs]);
  const working = useMemo(() => jobs.filter((j) => !isTerminalStatus(j.status)), [jobs]);
  const pendingIds = useMemo(() => jobs.filter((j) => isPending(j.status)).map((j) => j.id), [jobs]);
  const knownPipelineIds = useMemo(() => new Set(pipelines.list.map((p) => p.id)), [pipelines.list]);

  dragRef.current = drag;

  // A job you just added should be on screen; the queue runs top-down, so the
  // newest one is the last row of the lower band.
  useEffect(() => {
    const previous = jobCount.current;
    jobCount.current = jobs.length;
    if (jobs.length <= previous) return;
    const list = listRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
  }, [jobs.length]);

  // Clicking the mesh in the viewport asserts a selection; that has to show up
  // here, or the connection between the two is invisible.
  useEffect(() => {
    if (viewer.focusTick === 0 || !viewer.selectedJobId) return;
    const row = rootRef.current?.querySelector<HTMLElement>(`[data-job="${viewer.selectedJobId}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    row.classList.remove('is-pinged');
    // Restart the animation rather than waiting out the previous one.
    void row.offsetWidth;
    row.classList.add('is-pinged');
    const timer = setTimeout(() => row.classList.remove('is-pinged'), 900);
    return () => clearTimeout(timer);
  }, [viewer.focusTick, viewer.selectedJobId]);

  const move = useCallback(
    (job: GenerationJob, from: number, to: number) => {
      const clamped = Math.max(0, Math.min(pendingIds.length - 1, to));
      if (clamped === from) return;
      void generation.reorder(job.id, clamped);
      setAnnouncement(`${jobTitle(job.draft)} moved to ${clamped + 1} of ${pendingIds.length} in the queue`);
    },
    [generation, pendingIds.length]
  );

  const endDrag = useCallback(
    (commit: boolean) => {
      const state = dragRef.current;
      setDrag(null);
      if (!state?.armed || !commit || state.to === state.from) return;
      const job = jobs.find((j) => j.id === state.id);
      if (job) move(job, state.from, state.to);
    },
    [jobs, move]
  );

  useEffect(() => {
    if (!drag) return;
    const onMove = (event: PointerEvent) => {
      const state = dragRef.current;
      if (!state || event.pointerId !== state.pointerId) return;
      const dy = event.clientY - state.startY;
      if (!state.armed && Math.abs(dy) <= DRAG_THRESHOLD) return;
      // The slot the dragged row now sits nearest, measured where they started.
      const carried = state.slots[state.from]!.top + dy;
      let to = state.from;
      let best = Infinity;
      state.slots.forEach((slot, index) => {
        const distance = Math.abs(slot.top - carried);
        if (distance < best) {
          best = distance;
          to = index;
        }
      });
      setDrag({ ...state, dy, to, armed: true });
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== dragRef.current?.pointerId) return;
      endDrag(true);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') endDrag(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [drag, endDrag]);

  const beginDrag = (job: GenerationJob, event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !isPending(job.status)) return;
    const list = listRef.current;
    if (!list) return;
    const slots: Slot[] = [];
    pendingIds.forEach((id) => {
      const el = list.querySelector<HTMLElement>(`[data-job="${id}"]`);
      if (el) slots.push({ id, top: el.getBoundingClientRect().top });
    });
    const from = slots.findIndex((slot) => slot.id === job.id);
    if (from < 0) return;
    event.preventDefault();
    setDrag({ id: job.id, pointerId: event.pointerId, startY: event.clientY, dy: 0, from, to: from, slots, armed: false });
  };

  const onGripKeyDown = (job: GenerationJob, index: number) => (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    move(job, index, index + (event.key === 'ArrowUp' ? -1 : 1));
  };

  /** The drag lifts one row and opens a gap for it; nothing else moves. */
  const offsetFor = (jobId: string, index: number): number => {
    if (!drag?.armed || index < 0 || index >= drag.slots.length) return 0;
    if (jobId === drag.id) return drag.dy;
    const { from, to, slots } = drag;
    if (from < to && index > from && index <= to) return slots[index - 1]!.top - slots[index]!.top;
    if (from > to && index >= to && index < from) return slots[index + 1]!.top - slots[index]!.top;
    return 0;
  };

  return (
    <section className="gen-queue" aria-label="Jobs" ref={rootRef}>
      {finished.length > 0 && (
        <>
          <header className="gen-band">
            <span className="gen-band-label">Finished</span>
            <span className="gen-band-rule" />
            <span className="gen-band-count">{finished.length}</span>
          </header>
          <ul className="gen-shelf">
            {finished.map((job) => (
              <FinishedJob
                key={job.id}
                job={job}
                selected={viewer.selectedJobId === job.id}
                onSelect={() => viewerActions.select(job.id)}
              />
            ))}
          </ul>
        </>
      )}

      {/* The rule, the count and the one control that grows the queue. Outside
          the scrolling list on purpose: adding a job must not depend on how
          far down the list you happen to be. */}
      <header className="gen-band">
        <span className="gen-band-label">Queue</span>
        <span className="gen-band-rule" />
        <span className="gen-band-count">
          {counts.busy
            ? 'running'
            : counts.runnable > 0
              ? `${counts.runnable} ready`
              : counts.blocked > 0
                ? `${counts.blocked} unfinished`
                : 'empty'}
        </span>
        <Tooltip content="Add an empty job" position="top" align="end">
          <button
            type="button"
            className="gen-band-add"
            aria-label="Add an empty job"
            onClick={() => void generation.addJobs()}
          >
            <PlusIcon size={13} />
          </button>
        </Tooltip>
      </header>

      {working.length === 0 ? (
        <p className="gen-queue-empty">Drop a picture anywhere in the window, or add an empty job.</p>
      ) : (
        <ul className={`gen-queue-list ${drag?.armed ? 'is-reordering' : ''}`} ref={listRef}>
          {working.map((job) => {
            const index = pendingIds.indexOf(job.id);
            return (
              <JobRow
                key={job.id}
                job={job}
                queueIndex={index}
                queueCount={pendingIds.length}
                installedModelIds={installedModelIds}
                knownPipelineIds={knownPipelineIds}
                selected={viewer.selectedJobId === job.id}
                onSelect={() => viewerActions.select(job.id)}
                dragging={drag?.armed === true && drag.id === job.id}
                offsetY={offsetFor(job.id, index)}
                onGripPointerDown={(event) => beginDrag(job, event)}
                onGripKeyDown={onGripKeyDown(job, index)}
              />
            );
          })}
        </ul>
      )}

      <p className="gen-live" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
};
