import type { DevicePreference, PrecisionPreference } from './env';
import type { JobDraft, JobRevision, JobStatus } from './jobs';

/**
 * A job as handed to the python worker (see resources/python/PROTOCOL.md).
 * Produced by compilePipeline() in pipeline.ts; pure data, JSON-safe.
 */
export type ExportFormat = 'glb' | 'obj' | 'stl' | 'ply';

// ---------------------------------------------------------------------------
// Mesh operations
//
// One vocabulary for both places a mesh gets edited: the post-process nodes a
// pipeline compiles into `GenerationJobSpec.postProcess`, and the tools in the
// Generate view acting on a finished output. Same ops, same options, same
// python implementations - only the mesh they start from differs.
// ---------------------------------------------------------------------------

export type MeshOpKind =
  | 'remove-floaters'
  | 'remove-degenerate'
  | 'fill-holes'
  | 'decimate'
  | 'smooth'
  | 'recompute-normals';

/** Drop connected components smaller than `threshold` of the largest one. */
export interface RemoveFloatersOp {
  op: 'remove-floaters';
  /** 0-1; 0.1 keeps anything at least a tenth the size of the biggest part. */
  threshold: number;
}

/** Drop zero-area faces, optionally welding duplicate vertices first. */
export interface RemoveDegenerateOp {
  op: 'remove-degenerate';
  mergeVertices: boolean;
}

/** Close small boundary loops (triangulated fans). */
export interface FillHolesOp {
  op: 'fill-holes';
}

/** Quadric decimation, to a fraction of the current count or a hard cap. */
export interface DecimateOp {
  op: 'decimate';
  mode: 'ratio' | 'faces';
  /** Fraction of the current face count, used when mode is 'ratio'. */
  ratio: number;
  /** Face cap, used when mode is 'faces'; a mesh already under it is left alone. */
  maxFaces: number;
}

/** Taubin smoothing: volume-preserving, unlike plain Laplacian. */
export interface SmoothOp {
  op: 'smooth';
  iterations: number;
}

/** Recompute face/vertex normals and fix winding. */
export interface RecomputeNormalsOp {
  op: 'recompute-normals';
}

export type MeshOp =
  | RemoveFloatersOp
  | RemoveDegenerateOp
  | FillHolesOp
  | DecimateOp
  | SmoothOp
  | RecomputeNormalsOp;

export const MAX_SMOOTH_ITERATIONS = 200;
export const MIN_DECIMATE_FACES = 100;

export interface MeshOpDefinition {
  kind: MeshOpKind;
  /** Pipeline node title. */
  label: string;
  /** Generate-view toolbar label, kept short enough for the plate. */
  short: string;
  description: string;
  /** Appended to the file stem when the op runs as a tool. */
  suffix: string;
  defaults: () => MeshOp;
}

/** Canonical order: how the node palette and the mesh toolbar list the ops. */
export const MESH_OP_KINDS: MeshOpKind[] = [
  'remove-floaters',
  'remove-degenerate',
  'fill-holes',
  'decimate',
  'smooth',
  'recompute-normals',
];

export const MESH_OP_DEFINITIONS: Record<MeshOpKind, MeshOpDefinition> = {
  'remove-floaters': {
    kind: 'remove-floaters',
    label: 'Remove Floaters',
    short: 'Floaters',
    description: 'Keeps the main body and drops the loose fragments floating around it.',
    suffix: 'floaters',
    defaults: (): RemoveFloatersOp => ({ op: 'remove-floaters', threshold: 0.1 }),
  },
  'remove-degenerate': {
    kind: 'remove-degenerate',
    label: 'Remove Degenerate Faces',
    short: 'Clean',
    description: 'Drops zero-area faces and the stray vertices left behind.',
    suffix: 'cleaned',
    defaults: (): RemoveDegenerateOp => ({ op: 'remove-degenerate', mergeVertices: true }),
  },
  'fill-holes': {
    kind: 'fill-holes',
    label: 'Fill Holes',
    short: 'Holes',
    description: 'Closes small gaps in the surface. Large openings are left alone.',
    suffix: 'filled',
    defaults: (): FillHolesOp => ({ op: 'fill-holes' }),
  },
  decimate: {
    kind: 'decimate',
    label: 'Decimate',
    short: 'Reduce',
    description: 'Cuts the face count down, by ratio or to a hard cap.',
    suffix: 'reduced',
    defaults: (): DecimateOp => ({ op: 'decimate', mode: 'faces', ratio: 0.5, maxFaces: 50000 }),
  },
  smooth: {
    kind: 'smooth',
    label: 'Smooth',
    short: 'Smooth',
    description: 'Taubin smoothing: softens stair-stepping without shrinking the shape.',
    suffix: 'smooth',
    defaults: (): SmoothOp => ({ op: 'smooth', iterations: 15 }),
  },
  'recompute-normals': {
    kind: 'recompute-normals',
    label: 'Recompute Normals',
    short: 'Normals',
    description: 'Rebuilds normals and winding, fixing dark or inside-out shading.',
    suffix: 'normals',
    defaults: (): RecomputeNormalsOp => ({ op: 'recompute-normals' }),
  },
};

export function isMeshOpKind(value: unknown): value is MeshOpKind {
  return typeof value === 'string' && value in MESH_OP_DEFINITIONS;
}

function numberOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Coerce loose JSON (node data, an IPC payload) into a valid op. Throws with a
 * message meant for a toast; the renderer, main and the worker all run it, so
 * a bad value is rejected at every boundary rather than reaching trimesh.
 */
export function normalizeMeshOp(raw: unknown): MeshOp {
  const value = (raw ?? {}) as Record<string, unknown>;
  const kind = value['op'];
  if (!isMeshOpKind(kind)) throw new Error(`Unknown mesh operation "${String(kind)}".`);
  switch (kind) {
    case 'remove-floaters': {
      const threshold = numberOr(value['threshold'], 0.1);
      if (threshold <= 0 || threshold > 1) {
        throw new Error('Remove Floaters needs a threshold above 0 and at most 1.');
      }
      return { op: 'remove-floaters', threshold };
    }
    case 'remove-degenerate':
      return { op: 'remove-degenerate', mergeVertices: value['mergeVertices'] !== false };
    case 'fill-holes':
      return { op: 'fill-holes' };
    case 'decimate': {
      const mode = value['mode'] === 'ratio' ? 'ratio' : 'faces';
      const ratio = numberOr(value['ratio'], 0.5);
      const maxFaces = Math.round(numberOr(value['maxFaces'], 50000));
      if (mode === 'ratio' && !(ratio > 0 && ratio < 1)) {
        throw new Error('Decimate needs a ratio strictly between 0 and 1.');
      }
      if (mode === 'faces' && maxFaces < MIN_DECIMATE_FACES) {
        throw new Error(`Decimate needs a face cap of at least ${MIN_DECIMATE_FACES}.`);
      }
      return { op: 'decimate', mode, ratio, maxFaces };
    }
    case 'smooth': {
      const iterations = Math.round(numberOr(value['iterations'], 15));
      if (iterations < 1 || iterations > MAX_SMOOTH_ITERATIONS) {
        throw new Error(`Smooth needs an iteration count between 1 and ${MAX_SMOOTH_ITERATIONS}.`);
      }
      return { op: 'smooth', iterations };
    }
    case 'recompute-normals':
      return { op: 'recompute-normals' };
  }
}

export function normalizeMeshOps(raw: unknown): MeshOp[] {
  if (!Array.isArray(raw)) throw new Error('`ops` must be a list of mesh operations.');
  return raw.map(normalizeMeshOp);
}

/** One-line summary for logs and tooltips. */
export function describeMeshOp(op: MeshOp): string {
  switch (op.op) {
    case 'remove-floaters':
      return `remove floaters below ${Math.round(op.threshold * 100)}%`;
    case 'remove-degenerate':
      return op.mergeVertices ? 'remove degenerate faces (merging vertices)' : 'remove degenerate faces';
    case 'fill-holes':
      return 'fill holes';
    case 'decimate':
      return op.mode === 'ratio'
        ? `decimate to ${Math.round(op.ratio * 100)}%`
        : `decimate to ${op.maxFaces} faces`;
    case 'smooth':
      return `smooth x${op.iterations}`;
    case 'recompute-normals':
      return 'recompute normals';
  }
}

export interface GenerationJobSpec {
  jobId: string;
  modelId: string;
  /** Absolute path under inputs/ (main copies the source there first). */
  imagePath: string;
  removeBackground: boolean;
  /** Model settings; keys come from ModelDefinition.settings. Seed already resolved (never -1). */
  settings: Record<string, number | string | boolean>;
  /** Ordered post-process chain, compiled from the pipeline's op nodes. */
  postProcess: MeshOp[];
  export: {
    format: ExportFormat;
    /** Absolute directory (outputs/). */
    outputDir: string;
    /** File stem without extension; the worker appends the extension. */
    baseName: string;
  };
}

export interface JobProgress {
  /** 0-100 */
  pct: number;
  /** Short machine-ish stage id: "load", "condition", "diffusion", "decode", a MeshOpKind, "export". */
  stage: string;
  message: string;
}

/**
 * One job in the queue. The `draft` is the editable half — source, image, name,
 * modifiers — and everything else is what has happened to it since. A job stays
 * in this list after it finishes, holding its revision history, until the user
 * saves it into outputs/ or deletes it; main persists the whole list, so the
 * work survives a restart.
 */
export interface GenerationJob {
  id: string;
  draft: JobDraft;
  /** Compiled from the draft at start time; absent until the job runs. */
  spec?: GenerationJobSpec;
  /** The job's own copy of the image, under inputs/<jobId>/. Null until one is attached. */
  imagePath: string | null;
  /** Basename of that copy, for the row. */
  imageName: string | null;
  /** Where this job's mesh revisions live: cache/<jobId>/. */
  cacheDir: string;
  status: JobStatus;
  progress: JobProgress;
  createdAt: number;
  startedAt?: number;
  /** When the model was ready and generation proper began (after any load). */
  runningAt?: number;
  finishedAt?: number;
  /**
   * The mesh and every edit applied to it, oldest first. Empty until the job
   * produces something.
   */
  revisions: JobRevision[];
  /** Which revision the viewer shows and Save would write out. */
  cursor: number;
  /** An edit running on this job's mesh right now, if any. */
  editing: { op: MeshOpKind; pct: number; message: string } | null;
  error?: string;
  /** Set when the job has been written into outputs/; the job then leaves the list. */
  savedPath?: string;
}

/** The revision a job currently points at, or null when it has none. */
export function currentRevision(job: GenerationJob): JobRevision | null {
  return job.revisions[job.cursor] ?? null;
}

/** Convenience for everything that still just wants "the mesh file". */
export function jobOutputPath(job: GenerationJob): string | null {
  return currentRevision(job)?.path ?? null;
}

export type WorkerStatus =
  | 'stopped'
  | 'starting'
  | 'idle'
  | 'loading'
  | 'generating'
  | 'processing'
  | 'unloading'
  | 'error';

// ---------------------------------------------------------------------------
// Running those ops on an existing output (Generate view tools). Handled by
// the python worker with trimesh; no model needs to be loaded.
// ---------------------------------------------------------------------------

export interface MeshProcessRequest {
  /** Absolute path under outputs/. */
  inputPath: string;
  ops: MeshOp[];
}

export interface MeshProcessResult {
  outputPath: string;
  vertices: number;
  faces: number;
  durationMs: number;
}

/** Live progress of the one in-flight mesh process request, for the HUD. */
export interface MeshProcessProgress {
  requestId: string;
  /** The job whose mesh is being edited, so the row can show it. */
  jobId: string;
  /** "load" | "export" | a MeshOpKind */
  stage: string;
  /** 0-100 */
  pct: number;
  message: string;
  startedAt: number;
}

export interface MemoryStats {
  vramUsedBytes: number | null;
  vramTotalBytes: number | null;
  ramUsedBytes: number | null;
  /** ms since epoch when this was sampled */
  sampledAt: number;
}

/**
 * Full snapshot the main process pushes on every change (GEN_STATE_CHANGED).
 * Small enough to send whole; the renderer store replaces its state with it.
 */
export interface GenerationState {
  worker: WorkerStatus;
  workerError: string | null;
  loadedModelId: string | null;
  /** The model currently being loaded, while worker === 'loading'. */
  loadingModelId: string | null;
  device: DevicePreference;
  precision: PrecisionPreference;
  memory: MemoryStats;
  /**
   * Every job, in the order the queue runs them. Drafts, queued work and
   * finished jobs all live here; a finished job leaves only when it is saved
   * or deleted.
   */
  jobs: GenerationJob[];
  activeJobId: string | null;
  /** ms since epoch of the next scheduled idle unload, if any. */
  idleUnloadAt: number | null;
  /** The in-flight mesh edit, if any. Only ever one at a time. */
  processing: MeshProcessProgress | null;
}

export interface OutputItem {
  path: string;
  name: string;
  format: ExportFormat;
  sizeBytes: number;
  createdAt: number;
  jobId?: string;
  modelId?: string;
}

// ---------------------------------------------------------------------------
// Worker protocol (JSON lines over stdin/stdout). Mirrored in PROTOCOL.md.
// ---------------------------------------------------------------------------

export type WorkerCommand =
  | { cmd: 'ping' }
  | {
      cmd: 'load';
      model_id: string;
      model_dir: string;
      device: DevicePreference;
      precision: PrecisionPreference;
      low_vram: boolean;
    }
  | { cmd: 'unload' }
  | { cmd: 'generate'; job: GenerationJobSpec }
  | {
      cmd: 'process';
      request_id: string;
      input: string;
      /** Absolute output path including extension; the worker unique-ifies the stem if it exists. */
      output: string;
      ops: MeshOp[];
    }
  | { cmd: 'cancel'; job_id: string }
  | { cmd: 'memory' }
  | { cmd: 'shutdown' };

export type WorkerEvent =
  | {
      event: 'ready';
      python: string;
      torch: string | null;
      cuda: boolean;
      gpu: string | null;
      vram_total: number | null;
    }
  | { event: 'pong' }
  | { event: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; message: string; job_id?: string }
  | { event: 'progress'; job_id: string; pct: number; stage: string; message: string }
  | { event: 'loaded'; model_id: string; duration_ms: number }
  | { event: 'unloaded' }
  | {
      event: 'done';
      job_id: string;
      output: string;
      vertices: number;
      faces: number;
      duration_ms: number;
    }
  | { event: 'cancelled'; job_id: string }
  | {
      event: 'processed';
      request_id: string;
      output: string;
      vertices: number;
      faces: number;
      duration_ms: number;
    }
  | { event: 'error'; job_id?: string; request_id?: string; message: string; traceback?: string; oom?: boolean }
  | { event: 'memory'; vram_used: number | null; vram_total: number | null; ram_used: number | null };
