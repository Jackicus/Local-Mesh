import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GenerationJob } from '../../../core/types';
import { EraserIcon } from '../../assets/icons';
import { useGenerationStore } from '../../stores/generationStore';
import { Composer } from './Composer';
import type { BarPanel } from './QueueBar';
import { QueueBar } from './QueueBar';
import { useViewerStore } from './viewerStore';

const FINISHED = new Set(['done', 'failed', 'cancelled']);
/** How far the pointer travels before a press on the grip becomes a drag. */
const DRAG_THRESHOLD = 4;
/** The composer's key in the one-panel-at-a-time bookkeeping. */
const COMPOSER = 'composer';

interface Slot {
  id: string;
  /** Viewport y of the bar when the drag started. */
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

interface OpenPanel {
  id: string;
  panel: Exclude<BarPanel, null>;
}

/**
 * The queue, bottom left: every job as a bar, in the order main will run them,
 * and the composer as the last bar of the same stack — what is about to run,
 * sitting where it will appear.
 *
 * One panel is open at a time across the whole stack. The bars live in a
 * scrolling list, so a floating popover would be clipped by it; expanding in
 * place keeps the chooser with its bar and the viewport clear.
 */
export const QueueStack: React.FC = () => {
  const [gen, generation] = useGenerationStore();
  const [viewer] = useViewerStore();
  const [open, setOpen] = useState<OpenPanel | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const listRef = useRef<HTMLUListElement>(null);
  const jobCount = useRef(0);
  const dragRef = useRef<DragState | null>(null);
  const stagedCount = useRef(viewer.images.length);

  // Main keeps the array in run order; that is the order to show and reorder in.
  const jobs = gen.jobs;
  const queuedIds = useMemo(() => jobs.filter((j) => j.status === 'queued').map((j) => j.id), [jobs]);
  const finishedCount = useMemo(() => jobs.filter((j) => FINISHED.has(j.status)).length, [jobs]);

  dragRef.current = drag;

  // Staging an image is a statement of intent: show what landed. Running them
  // empties the composer, so the drawer closes rather than sitting open on an
  // empty drop zone.
  useEffect(() => {
    const previous = stagedCount.current;
    stagedCount.current = viewer.images.length;
    if (viewer.images.length > previous) setOpen({ id: COMPOSER, panel: 'detail' });
    else if (viewer.images.length === 0 && previous > 0) {
      setOpen((prev) => (prev?.id === COMPOSER && prev.panel === 'detail' ? null : prev));
    }
  }, [viewer.images.length]);

  // Work you just started should be on screen: the queue runs top-down, so the
  // newest job is the last bar in the list.
  useEffect(() => {
    const previous = jobCount.current;
    jobCount.current = jobs.length;
    if (jobs.length <= previous) return;
    const list = listRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
  }, [jobs.length]);

  // A job that leaves the queue can't stay open around a stale panel.
  useEffect(() => {
    setOpen((prev) => (prev && prev.id !== COMPOSER && !jobs.some((j) => j.id === prev.id) ? null : prev));
  }, [jobs]);

  // An opened panel can sit below the fold of a long queue; bring it up.
  useEffect(() => {
    if (!open || open.id === COMPOSER) return;
    listRef.current
      ?.querySelector(`[data-job="${open.id}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [open]);

  // Escape closes whatever is expanded, the way it closes the tool panels.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && document.querySelector('.ui-modal-backdrop') === null) setOpen(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const panelFor = (id: string): BarPanel => (open?.id === id ? open.panel : null);

  const togglePanel = (id: string) => (panel: Exclude<BarPanel, null>) =>
    setOpen((prev) => (prev?.id === id && prev.panel === panel ? null : { id, panel }));

  const move = useCallback(
    (job: GenerationJob, from: number, to: number) => {
      const clamped = Math.max(0, Math.min(queuedIds.length - 1, to));
      if (clamped === from) return;
      void generation.reorder(job.id, clamped);
      setAnnouncement(`${job.imageName} moved to ${clamped + 1} of ${queuedIds.length} in the queue`);
    },
    [generation, queuedIds.length]
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

  // Pointer capture would tie the listeners to a button React can rerender out
  // from under us, so the window owns them for the length of the drag.
  useEffect(() => {
    if (!drag) return;
    const onMove = (event: PointerEvent) => {
      const state = dragRef.current;
      if (!state || event.pointerId !== state.pointerId) return;
      const dy = event.clientY - state.startY;
      if (!state.armed && Math.abs(dy) <= DRAG_THRESHOLD) return;
      // The slot the dragged bar now sits nearest, measured where they started.
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
    if (event.button !== 0 || job.status !== 'queued') return;
    const list = listRef.current;
    if (!list) return;
    const slots: Slot[] = [];
    queuedIds.forEach((id) => {
      const el = list.querySelector<HTMLElement>(`[data-job="${id}"]`);
      if (el) slots.push({ id, top: el.getBoundingClientRect().top });
    });
    const from = slots.findIndex((slot) => slot.id === job.id);
    if (from < 0) return;
    event.preventDefault();
    setOpen(null);
    setDrag({
      id: job.id,
      pointerId: event.pointerId,
      startY: event.clientY,
      dy: 0,
      from,
      to: from,
      slots,
      armed: false,
    });
  };

  const onGripKeyDown =
    (job: GenerationJob, index: number) => (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
      event.preventDefault();
      move(job, index, index + (event.key === 'ArrowUp' ? -1 : 1));
    };

  /** The drag lifts one bar and opens a gap for it; nothing else moves. */
  const offsetFor = (jobId: string, queuedIndex: number): number => {
    if (!drag?.armed || queuedIndex < 0 || queuedIndex >= drag.slots.length) return 0;
    if (jobId === drag.id) return drag.dy;
    const { from, to, slots } = drag;
    if (from < to && queuedIndex > from && queuedIndex <= to) {
      return slots[queuedIndex - 1]!.top - slots[queuedIndex]!.top;
    }
    if (from > to && queuedIndex >= to && queuedIndex < from) {
      return slots[queuedIndex + 1]!.top - slots[queuedIndex]!.top;
    }
    return 0;
  };

  return (
    <section className="gen-queue" aria-label="Generation queue">
      {jobs.length > 0 && (
        <>
          <header className="gen-queue-head">
            <span className="gen-queue-title">Queue</span>
            <span className="gen-queue-count">
              {queuedIds.length > 0 ? `${queuedIds.length} waiting` : 'nothing waiting'}
            </span>
            {finishedCount > 0 && (
              <button type="button" className="gen-queue-clear" onClick={() => void generation.clearFinished()}>
                <EraserIcon size={12} />
                Clear {finishedCount} finished
              </button>
            )}
          </header>

          <ul className={`gen-queue-list ${drag?.armed ? 'is-reordering' : ''}`} ref={listRef}>
            {jobs.map((job) => {
              const queuedIndex = queuedIds.indexOf(job.id);
              return (
                <QueueBar
                  key={job.id}
                  job={job}
                  queuedIndex={queuedIndex}
                  queuedCount={queuedIds.length}
                  panel={panelFor(job.id)}
                  onPanel={togglePanel(job.id)}
                  onClosePanel={() => setOpen(null)}
                  dragging={drag?.armed === true && drag.id === job.id}
                  offsetY={offsetFor(job.id, queuedIndex)}
                  onGripPointerDown={(event) => beginDrag(job, event)}
                  onGripKeyDown={onGripKeyDown(job, queuedIndex)}
                />
              );
            })}
          </ul>
        </>
      )}

      <Composer
        panel={panelFor(COMPOSER)}
        onPanel={togglePanel(COMPOSER)}
        onClosePanel={() => setOpen(null)}
      />

      <p className="gen-live" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
};
