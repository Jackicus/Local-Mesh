import type { DevicePreference, PrecisionPreference } from './env';

/**
 * A job as handed to the python worker (see resources/python/PROTOCOL.md).
 * Produced by compilePipeline() in pipeline.ts; pure data, JSON-safe.
 */
export type ExportFormat = 'glb' | 'obj' | 'stl' | 'ply';

export interface PostProcessSpec {
  removeFloaters: boolean;
  removeDegenerateFaces: boolean;
  /** Decimate to at most this many faces (null = keep). */
  maxFaces: number | null;
  /** Smooth normals in the export. */
  smoothNormals: boolean;
}

export interface GenerationJobSpec {
  jobId: string;
  modelId: string;
  /** Absolute path under inputs/ (main copies the source there first). */
  imagePath: string;
  removeBackground: boolean;
  /** Model settings; keys come from ModelDefinition.settings. Seed already resolved (never -1). */
  settings: Record<string, number | string | boolean>;
  postProcess: PostProcessSpec;
  export: {
    format: ExportFormat;
    /** Absolute directory (outputs/). */
    outputDir: string;
    /** File stem without extension; the worker appends the extension. */
    baseName: string;
  };
}

export type JobStatus = 'queued' | 'loading' | 'running' | 'done' | 'failed' | 'cancelled';

export interface JobProgress {
  /** 0-100 */
  pct: number;
  /** Short machine-ish stage id: "load", "condition", "diffusion", "decode", "postprocess", "export". */
  stage: string;
  message: string;
}

export interface GenerationJob {
  id: string;
  pipelineId: string;
  pipelineName: string;
  modelId: string;
  imagePath: string;
  imageName: string;
  spec: GenerationJobSpec;
  status: JobStatus;
  progress: JobProgress;
  createdAt: number;
  startedAt?: number;
  /** When the model was ready and generation proper began (after any load). */
  runningAt?: number;
  finishedAt?: number;
  outputPath?: string;
  stats?: { vertices: number; faces: number };
  error?: string;
}

/** What the Generate view sends: one request fans out into one job per image. */
export interface GenerationJobRequest {
  pipelineId: string;
  /** Absolute source paths chosen via dialog or drag-and-drop. */
  imagePaths: string[];
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
// Mesh post-processing on an existing output (Generate view tools). Runs in
// the python worker with trimesh; no model needs to be loaded.
// ---------------------------------------------------------------------------

export type MeshProcessOp =
  /** Decimate to `ratio` of the current face count (0 < ratio < 1). */
  | { op: 'decimate'; ratio: number }
  /** Taubin smoothing (volume-preserving), `iterations` passes. */
  | { op: 'smooth'; iterations: number };

export interface MeshProcessRequest {
  /** Absolute path under outputs/. */
  inputPath: string;
  ops: MeshProcessOp[];
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
  /** "load" | "decimate" | "smooth" | "export" */
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
  /** Oldest first; finished jobs stay until clearFinishedJobs(). */
  jobs: GenerationJob[];
  activeJobId: string | null;
  /** ms since epoch of the next scheduled idle unload, if any. */
  idleUnloadAt: number | null;
  /** The in-flight Reduce/Smooth request, if any. Only ever one at a time. */
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
      ops: MeshProcessOp[];
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
