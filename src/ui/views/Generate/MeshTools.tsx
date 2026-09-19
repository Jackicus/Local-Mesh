import React, { useCallback, useEffect, useState } from 'react';
import type { MeshOp, MeshOpKind } from '../../../core/types';
import { MESH_OP_DEFINITIONS, MESH_OP_KINDS } from '../../../core/types';
import { Button, Form, toast } from '../../components';
import {
  ChevronDownIcon,
  CleanIcon,
  FillHolesIcon,
  FloatersIcon,
  LoaderIcon,
  NormalsIcon,
  ReduceIcon,
  SmoothIcon,
  UndoIcon,
} from '../../assets/icons';
import { useEnvStore } from '../../stores/envStore';
import { useGenerationStore } from '../../stores/generationStore';
import { ProgressBar } from './ProgressBar';
import { useViewerStore } from './viewerStore';
import { formatCount, stageLabel } from './format';

const ICONS: Record<MeshOpKind, React.ReactNode> = {
  'remove-floaters': <FloatersIcon size={14} />,
  'remove-degenerate': <CleanIcon size={14} />,
  'fill-holes': <FillHolesIcon size={14} />,
  decimate: <ReduceIcon size={14} />,
  smooth: <SmoothIcon size={14} />,
  'recompute-normals': <NormalsIcon size={14} />,
};

const THRESHOLDS = [
  { value: '0.02', label: '2%' },
  { value: '0.1', label: '10%' },
  { value: '0.25', label: '25%' },
];

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
 * The same mesh ops a pipeline runs after generation, here as a hand tool on
 * the mesh already in view — one list behind the Edit plate. Ops with
 * something to choose expand their settings in place; the rest apply on
 * click. Each run writes a new file next to the old one, so Undo is just the
 * previous path.
 *
 * Defaults differ from the pipeline in one place: Reduce works by ratio, since
 * what you want on a mesh you are looking at is "half of this", not a cap.
 */
const initialOps = (): Record<MeshOpKind, MeshOp> => {
  const ops = Object.fromEntries(
    MESH_OP_KINDS.map((kind) => [kind, MESH_OP_DEFINITIONS[kind].defaults()])
  ) as Record<MeshOpKind, MeshOp>;
  ops.decimate = { op: 'decimate', mode: 'ratio', ratio: 0.5, maxFaces: 50000 };
  return ops;
};

export const MeshTools: React.FC = () => {
  const [viewer, viewerActions] = useViewerStore();
  const [gen, generation] = useGenerationStore();
  const [env] = useEnvStore();
  const [open, setOpen] = useState<MeshOpKind | null>(null);
  const [ops, setOps] = useState<Record<MeshOpKind, MeshOp>>(initialOps);

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

  const patch = useCallback(
    (kind: MeshOpKind, fields: Record<string, unknown>) =>
      setOps((prev) => ({ ...prev, [kind]: { ...prev[kind], ...fields } as MeshOp })),
    []
  );

  const apply = useCallback(
    async (kind: MeshOpKind) => {
      const current = viewer.loaded;
      if (!current || blocked) return;
      setOpen(null);
      viewerActions.setToolBusy(kind);
      try {
        const result = await generation.processMesh({ inputPath: current.path, ops: [ops[kind]] });
        if (!result) return;
        await viewerActions.applyProcessed(current.path, result.outputPath);
        toast.success(`${MESH_OP_DEFINITIONS[kind].label} · ${formatCount(result.faces)} faces`);
      } finally {
        viewerActions.setToolBusy(null);
      }
    },
    [viewer.loaded, blocked, ops, generation, viewerActions]
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
  const processing = gen.processing;

  const options = (kind: MeshOpKind): React.ReactNode => {
    const op = ops[kind];
    switch (op.op) {
      case 'remove-floaters':
        return (
          <>
            <span className="gen-popover-title">Keep parts above</span>
            <Form.Segmented
              size="sm"
              fullWidth
              options={THRESHOLDS}
              value={String(op.threshold)}
              onChange={(threshold) => patch(kind, { threshold: Number(threshold) })}
            />
            <div className="gen-popover-meta">
              <span>Of the largest part</span>
            </div>
          </>
        );
      case 'remove-degenerate':
        return (
          <>
            <span className="gen-popover-title">Degenerate faces</span>
            <div className="gen-popover-meta">
              <span>Merge vertices</span>
              <Form.Toggle
                size="sm"
                checked={op.mergeVertices}
                onChange={(mergeVertices) => patch(kind, { mergeVertices })}
                aria-label="Merge duplicate vertices"
              />
            </div>
          </>
        );
      case 'decimate':
        return (
          <>
            <span className="gen-popover-title">Target faces</span>
            <Form.Segmented
              size="sm"
              fullWidth
              options={RATIOS}
              value={String(op.ratio)}
              onChange={(ratio) => patch(kind, { ratio: Number(ratio) })}
            />
            <div className="gen-popover-meta">
              <span>{formatCount(faces)} now</span>
              <span>→ {formatCount(Math.round(faces * op.ratio))}</span>
            </div>
          </>
        );
      case 'smooth':
        return (
          <>
            <span className="gen-popover-title">Smoothing</span>
            <Form.Segmented
              size="sm"
              fullWidth
              options={ITERATIONS}
              value={String(op.iterations)}
              onChange={(iterations) => patch(kind, { iterations: Number(iterations) })}
            />
            <div className="gen-popover-meta">
              <span>Taubin</span>
              <span>{op.iterations} passes</span>
            </div>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div className="gen-edit">
      <header className="gen-panel-head">
        <span className="gen-panel-title">Edit mesh</span>
        {loaded && <span className="gen-panel-meta">{formatCount(faces)} faces</span>}
      </header>

      {reason && <p className="gen-edit-reason">{reason}</p>}

      {(running || processing) && (
        <div className="gen-edit-progress">
          <div className="gen-edit-progress-line">
            <span className="gen-popover-title">
              {processing
                ? stageLabel(processing.stage)
                : busy === 'undo'
                  ? 'Stepping back'
                  : busy
                    ? stageLabel(busy)
                    : 'Working'}
            </span>
            {processing && <span className="gen-qbar-pct">{Math.round(processing.pct)}%</span>}
          </div>
          <ProgressBar pct={processing?.pct ?? 0} indeterminate={!processing} />
        </div>
      )}

      <ul className="gen-edit-ops">
        {MESH_OP_KINDS.map((kind) => {
          const def = MESH_OP_DEFINITIONS[kind];
          const panel = options(kind);
          const isOpen = open === kind;
          return (
            <li key={kind} className={`gen-edit-item ${isOpen ? 'is-open' : ''}`}>
              <button
                type="button"
                className="gen-edit-op"
                disabled={blocked}
                title={def.description}
                aria-expanded={panel ? isOpen : undefined}
                onClick={() => (panel ? setOpen((prev) => (prev === kind ? null : kind)) : void apply(kind))}
              >
                <span className="gen-edit-op-icon">
                  {busy === kind ? <LoaderIcon size={14} className="gen-spin" /> : ICONS[kind]}
                </span>
                <span className="gen-edit-op-label">{def.short}</span>
                {panel && <ChevronDownIcon size={13} className={`gen-chevron ${isOpen ? 'is-open' : ''}`} />}
              </button>

              {panel && isOpen && (
                <div className="gen-edit-options">
                  {panel}
                  <Button variant="primary" size="sm" fullWidth onClick={() => void apply(kind)}>
                    Apply {def.short}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="gen-edit-foot">
        <span className="gen-popover-title">
          {viewer.history.length > 0 ? `${viewer.history.length} step${viewer.history.length > 1 ? 's' : ''} back` : 'No changes yet'}
        </span>
        <Button
          variant="subtle"
          size="sm"
          icon={busy === 'undo' ? <LoaderIcon size={13} className="gen-spin" /> : <UndoIcon size={13} />}
          disabled={viewer.history.length === 0 || running || jobActive}
          onClick={() => void undo()}
        >
          Undo
        </Button>
      </div>
    </div>
  );
};
