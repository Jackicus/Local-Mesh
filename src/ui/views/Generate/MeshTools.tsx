import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { MeshProcessOp } from '../../../core/types';
import { Button, Form, Tooltip, toast } from '../../components';
import { LoaderIcon, ReduceIcon, SmoothIcon, UndoIcon } from '../../assets/icons';
import { useEnvStore } from '../../stores/envStore';
import { useGenerationStore } from '../../stores/generationStore';
import { useViewerStore } from './viewerStore';
import { formatCount } from './format';

type ToolId = 'reduce' | 'smooth';

const RATIOS = [
  { value: '0.5', label: '50%' },
  { value: '0.25', label: '25%' },
  { value: '0.1', label: '10%' },
];

const ITERATIONS = [
  { value: '5', label: 'Light' },
  { value: '15', label: 'Medium' },
  { value: '40', label: 'Strong' },
];

/**
 * Edits to the mesh in view, kept in their own plate beside the camera tools:
 * those change how you look at the model, these change the model. Each run
 * writes a new file next to the old one, so Undo is just the previous path.
 */
export const MeshTools: React.FC = () => {
  const [viewer, viewerActions] = useViewerStore();
  const [gen, generation] = useGenerationStore();
  const [env] = useEnvStore();
  const [open, setOpen] = useState<ToolId | null>(null);
  const [ratio, setRatio] = useState('0.5');
  const [iterations, setIterations] = useState('15');
  const rootRef = useRef<HTMLDivElement>(null);

  const outputsDir = env.paths?.outputs ?? null;
  const loaded = viewer.loaded;
  const fromOutputs = Boolean(loaded && outputsDir && loaded.path.startsWith(outputsDir));
  const jobActive = gen.jobs.some((j) => j.status === 'running' || j.status === 'loading');
  const busy = viewer.toolBusy;
  const running = busy !== null || gen.processing != null;

  const reason = !fromOutputs
    ? 'Load a generated mesh first'
    : jobActive
      ? 'Wait for the current job'
      : null;
  const blocked = reason !== null || running;

  useEffect(() => {
    if (blocked) setOpen(null);
  }, [blocked]);

  // Dismiss on anything that reads as "elsewhere": a click outside, or Escape.
  useEffect(() => {
    if (open === null) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const apply = useCallback(
    async (tool: ToolId) => {
      const current = viewer.loaded;
      if (!current || blocked) return;
      setOpen(null);
      const ops: MeshProcessOp[] =
        tool === 'reduce'
          ? [{ op: 'decimate', ratio: Number(ratio) }]
          : [{ op: 'smooth', iterations: Number(iterations) }];
      viewerActions.setToolBusy(tool);
      try {
        const result = await generation.processMesh({ inputPath: current.path, ops });
        if (!result) return;
        await viewerActions.applyProcessed(current.path, result.outputPath);
        toast.success(
          tool === 'reduce' ? `Reduced to ${formatCount(result.faces)} faces` : 'Smoothed'
        );
      } finally {
        viewerActions.setToolBusy(null);
      }
    },
    [viewer.loaded, blocked, ratio, iterations, generation, viewerActions]
  );

  const undo = useCallback(async () => {
    viewerActions.setToolBusy('undo');
    try {
      await viewerActions.undo();
    } finally {
      viewerActions.setToolBusy(null);
    }
  }, [viewerActions]);

  const faces = loaded?.faces ?? 0;

  const tool = (id: ToolId, label: string, icon: React.ReactNode) => (
    <div className="gen-mesh-item">
      <Tooltip content={reason ?? `${label} the mesh in view`} position="top" disabled={open === id}>
        <button
          type="button"
          className={`gen-mesh-btn ${open === id ? 'is-active' : ''}`}
          disabled={blocked}
          aria-expanded={open === id}
          aria-haspopup="dialog"
          onClick={() => setOpen((prev) => (prev === id ? null : id))}
        >
          {busy === id ? <LoaderIcon size={14} className="gen-spin" /> : icon}
          <span>{label}</span>
        </button>
      </Tooltip>

      {open === id && (
        <div className="gen-popover" role="dialog" aria-label={`${label} mesh`}>
          {id === 'reduce' ? (
            <>
              <span className="gen-popover-title">Target faces</span>
              <Form.Segmented size="sm" fullWidth options={RATIOS} value={ratio} onChange={setRatio} />
              <div className="gen-popover-meta">
                <span>{formatCount(faces)} now</span>
                <span>→ {formatCount(Math.round(faces * Number(ratio)))}</span>
              </div>
            </>
          ) : (
            <>
              <span className="gen-popover-title">Smoothing</span>
              <Form.Segmented
                size="sm"
                fullWidth
                options={ITERATIONS}
                value={iterations}
                onChange={setIterations}
              />
              <div className="gen-popover-meta">
                <span>Taubin</span>
                <span>{iterations} passes</span>
              </div>
            </>
          )}
          <Button variant="primary" size="sm" fullWidth onClick={() => void apply(id)}>
            Apply
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="gen-mesh-tools" ref={rootRef}>
      {tool('reduce', 'Reduce', <ReduceIcon size={14} />)}
      {tool('smooth', 'Smooth', <SmoothIcon size={14} />)}
      <span className="gen-tool-divider" />
      <Tooltip content={viewer.history.length > 0 ? 'Undo last change' : 'Nothing to undo'} position="top">
        <button
          type="button"
          className="gen-mesh-btn gen-mesh-btn-icon"
          aria-label="Undo last mesh change"
          disabled={viewer.history.length === 0 || running || jobActive}
          onClick={() => void undo()}
        >
          {busy === 'undo' ? <LoaderIcon size={14} className="gen-spin" /> : <UndoIcon size={14} />}
        </button>
      </Tooltip>
    </div>
  );
};
