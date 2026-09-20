import React, { useEffect, useRef, useState } from 'react';
import { Tooltip } from '../../components';
import { EditIcon, FolderIcon, LoaderIcon, PlayIcon } from '../../assets/icons';
import { useGenerationStore } from '../../stores/generationStore';
import { MeshTools } from './MeshTools';
import { OutputsPanel } from './OutputsPanel';
import { useQueueCounts } from './queueState';

type PlateId = 'edit' | 'outputs';

const HINTS: Record<PlateId, string> = {
  edit: 'Edit the selected mesh',
  outputs: 'Meshes you saved',
};

/**
 * Bottom right: the one control that sets the queue going, and two plates that
 * each open one panel.
 *
 * Start lives here rather than on the rows because jobs never run in parallel
 * — there is one line and one way to set it moving, so there is one button,
 * across the band from the queue it acts on and reading its count. A per-row
 * Generate would be six buttons all meaning the same thing.
 *
 * Only one plate is ever open: they act on the same viewport and would
 * otherwise cover each other as well as the model.
 */
export const ToolPlates: React.FC = () => {
  const [, generation] = useGenerationStore();
  const counts = useQueueCounts();
  const [open, setOpen] = useState<PlateId | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Dismiss on anything that reads as "elsewhere": a click outside, or Escape.
  // A modal raised from inside a panel (deleting an output) portals to the
  // body, so while one is up the panel behind it stays put and Escape is the
  // modal's to answer.
  useEffect(() => {
    if (open === null) return;
    const modalUp = () => document.querySelector('.ui-modal-backdrop') !== null;
    const onPointerDown = (event: MouseEvent) => {
      if (modalUp()) return;
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !modalUp()) setOpen(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const plate = (id: PlateId, label: string, icon: React.ReactNode, panel: React.ReactNode) => {
    const isOpen = open === id;
    return (
      <div className="gen-toolplate">
        {isOpen && (
          <div className="gen-panel" role="dialog" aria-label={label}>
            {panel}
          </div>
        )}
        <Tooltip content={HINTS[id]} position="top" align="end" disabled={isOpen}>
          <button
            type="button"
            className={`gen-tool-btn ${isOpen ? 'is-active' : ''}`}
            aria-expanded={isOpen}
            aria-haspopup="dialog"
            onClick={() => setOpen((prev) => (prev === id ? null : id))}
          >
            {icon}
            <span>{label}</span>
          </button>
        </Tooltip>
      </div>
    );
  };

  const startHint = counts.busy
    ? 'The queue is already running'
    : counts.runnable > 0
      ? `Runs ${counts.runnable === 1 ? 'the job' : `all ${counts.runnable} jobs`} in order, top to bottom`
      : counts.blocked > 0
        ? 'Every job is still missing something — check the queue'
        : 'Add a job first';

  return (
    <div className="gen-plates" ref={rootRef}>
      <Tooltip content={startHint} position="top" align="end">
        <button
          type="button"
          className="gen-start"
          disabled={counts.busy || counts.runnable === 0}
          onClick={() => void generation.start()}
        >
          {counts.busy ? <LoaderIcon size={14} className="gen-spin" /> : <PlayIcon size={14} />}
          <span>{counts.busy ? 'Running' : 'Start'}</span>
          {!counts.busy && counts.runnable > 0 && <span className="gen-start-count">{counts.runnable}</span>}
        </button>
      </Tooltip>

      {plate(
        'edit',
        'Edit',
        counts.editing ? <LoaderIcon size={14} className="gen-spin" /> : <EditIcon size={14} />,
        <MeshTools />
      )}
      {plate('outputs', 'Saved', <FolderIcon size={14} />, <OutputsPanel />)}
    </div>
  );
};
