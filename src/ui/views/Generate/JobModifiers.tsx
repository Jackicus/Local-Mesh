import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { GenerationJob, MeshOp, MeshOpKind } from '../../../core/types';
import { MESH_OP_DEFINITIONS, MESH_OP_KINDS } from '../../../core/types';
import type { JobModifier } from '../../../core/jobs';
import { makeModifier } from '../../../core/jobs';
import { Button } from '../../components';
import { PlusIcon, TrashIcon } from '../../assets/icons';
import { generationStore } from '../../stores/generationStore';
import { RowPopover, usePopover } from './RowPopover';
import { MESH_OP_ICONS, MeshOpOptions, defaultOp, hasOptions, opSummary } from './meshOpUi';

/** How far the pointer travels sideways before a press on a chip becomes a drag. */
const DRAG_THRESHOLD = 4;

export interface JobModifiersProps {
  job: GenerationJob;
  editable: boolean;
}

/**
 * The edits this job will run after the model, in the order it will run them.
 *
 * Drawn as a chain rather than a list because that is what it is: the output
 * of one is the input of the next, the same op can appear twice, and the order
 * changes the result. A chip is one link — click it to change what it does,
 * drag it to move it in the chain, and the chain scrolls sideways inside the
 * row rather than growing the row, so twelve edits and none look the same
 * width from the outside.
 *
 * Once the job has run these stop being instructions and become history: the
 * chips grey out and the same edits are applied one at a time from the Edit
 * plate, landing as revisions instead.
 */
export const JobModifiers: React.FC<JobModifiersProps> = ({ job, editable }) => {
  const modifiers = job.draft.modifiers;
  const add = usePopover();
  const [editing, setEditing] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const [drag, setDrag] = useState<{ id: string; from: number; to: number; pointerId: number; startX: number; armed: boolean } | null>(null);
  const dragRef = useRef(drag);
  const trackRef = useRef<HTMLDivElement>(null);
  dragRef.current = drag;

  const write = useCallback(
    (next: JobModifier[]) => void generationStore.updateJob(job.id, { modifiers: next }),
    [job.id]
  );

  const move = useCallback(
    (from: number, to: number) => {
      const clamped = Math.max(0, Math.min(modifiers.length - 1, to));
      if (clamped === from) return;
      const next = modifiers.slice();
      const [carried] = next.splice(from, 1);
      if (carried) next.splice(clamped, 0, carried);
      write(next);
    },
    [modifiers, write]
  );

  // Window-level for the same reason the queue's own drag is: a re-render
  // during the drag would take a capturing element out from under us.
  useEffect(() => {
    if (!drag) return;
    const onMove = (event: PointerEvent) => {
      const state = dragRef.current;
      if (!state || event.pointerId !== state.pointerId) return;
      if (!state.armed && Math.abs(event.clientX - state.startX) <= DRAG_THRESHOLD) return;
      const chips = Array.from(trackRef.current?.querySelectorAll<HTMLElement>('[data-mod]') ?? []);
      let to = state.from;
      let best = Infinity;
      chips.forEach((chip, index) => {
        const rect = chip.getBoundingClientRect();
        const distance = Math.abs(rect.left + rect.width / 2 - event.clientX);
        if (distance < best) {
          best = distance;
          to = index;
        }
      });
      setDrag({ ...state, to, armed: true });
    };
    const onUp = (event: PointerEvent) => {
      const state = dragRef.current;
      setDrag(null);
      if (!state || event.pointerId !== state.pointerId || !state.armed) return;
      move(state.from, state.to);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrag(null);
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
  }, [drag, move]);

  const current = editing ? modifiers.find((m) => m.id === editing.id) : undefined;

  return (
    <div className="gen-chain">
      <div className={`gen-chain-track ${drag?.armed ? 'is-reordering' : ''}`} ref={trackRef}>
        {modifiers.map((modifier, index) => {
          const def = MESH_OP_DEFINITIONS[modifier.op.op];
          const lifted = drag?.armed === true && drag.id === modifier.id;
          return (
            <button
              key={modifier.id}
              data-mod={modifier.id}
              type="button"
              className={`gen-chip ${lifted ? 'is-dragging' : ''} ${editing?.id === modifier.id ? 'is-open' : ''}`}
              disabled={!editable}
              title={`${opSummary(modifier.op)} — ${def.description}`}
              aria-label={`${opSummary(modifier.op)}, step ${index + 1} of ${modifiers.length}. Hold Alt and press the arrow keys to move it.`}
              onPointerDown={(event) => {
                if (!editable || event.button !== 0) return;
                setDrag({ id: modifier.id, from: index, to: index, pointerId: event.pointerId, startX: event.clientX, armed: false });
              }}
              onKeyDown={(event) => {
                if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
                event.preventDefault();
                move(index, index + (event.key === 'ArrowLeft' ? -1 : 1));
              }}
              onClick={(event) => {
                if (!editable || drag?.armed) return;
                setEditing({ id: modifier.id, anchor: event.currentTarget });
              }}
            >
              <span className="gen-chip-icon" aria-hidden="true">
                {MESH_OP_ICONS[modifier.op.op]}
              </span>
              <span className="gen-chip-label">{def.short}</span>
            </button>
          );
        })}
      </div>

      <button
        ref={add.ref}
        type="button"
        className={`gen-rowbtn gen-chain-add ${add.open ? 'is-active' : ''}`}
        disabled={!editable}
        aria-haspopup="dialog"
        aria-expanded={add.open}
        aria-label="Add a mesh edit"
        title="Add a mesh edit"
        onClick={add.toggle}
      >
        <PlusIcon size={14} />
      </button>

      <RowPopover open={add.open} anchor={add.anchor} onClose={add.close} label="Add a mesh edit" width={248}>
        <span className="gen-popover-title">Run after generating</span>
        <ul className="gen-choices">
          {MESH_OP_KINDS.map((kind: MeshOpKind) => {
            const def = MESH_OP_DEFINITIONS[kind];
            return (
              <li key={kind}>
                <button
                  type="button"
                  className="gen-choice"
                  onClick={() => {
                    add.close();
                    write([...modifiers, makeModifier(defaultOp(kind, 'modifier'))]);
                  }}
                >
                  <span className="gen-choice-icon" aria-hidden="true">
                    {MESH_OP_ICONS[kind]}
                  </span>
                  <span className="gen-choice-name">{def.label}</span>
                  <span className="gen-choice-hint">{def.description}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </RowPopover>

      <RowPopover
        open={current !== undefined}
        anchor={editing?.anchor ?? null}
        onClose={() => setEditing(null)}
        label="Edit step"
        width={232}
      >
        {current && (
          <>
            <span className="gen-popover-title">{MESH_OP_DEFINITIONS[current.op.op].label}</span>
            {hasOptions(current.op) ? (
              <MeshOpOptions
                op={current.op}
                onChange={(op: MeshOp) => write(modifiers.map((m) => (m.id === current.id ? { ...m, op } : m)))}
              />
            ) : (
              <p className="gen-popover-note">{MESH_OP_DEFINITIONS[current.op.op].description}</p>
            )}
            <Button
              variant="subtle"
              size="sm"
              fullWidth
              icon={<TrashIcon size={13} />}
              onClick={() => {
                setEditing(null);
                write(modifiers.filter((m) => m.id !== current.id));
              }}
            >
              Remove this step
            </Button>
          </>
        )}
      </RowPopover>
    </div>
  );
};
