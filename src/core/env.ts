/**
 * Everything lives under ~/.local-mesh. The main process creates the tree on
 * startup; the renderer only ever sees absolute paths through getPaths().
 */
export interface LocalMeshPaths {
  root: string; // ~/.local-mesh
  env: string; // uv-managed virtualenv
  /** The app's bundled resources/python (worker, backends, requirements); never copied. */
  scripts: string;
  models: string; // one subdirectory per model id (HF snapshot)
  outputs: string; // generated meshes
  inputs: string; // copies of input images (so jobs survive the source moving)
  pipelines: string; // saved node graphs, one JSON per pipeline
  logs: string; // general.log, errors.log, generation.log
}

export type EnvPhase =
  | 'idle'
  | 'checking'
  | 'creating-venv'
  | 'installing-torch'
  | 'installing-base'
  | 'verifying'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface EnvStatus {
  /** `uv` found on PATH (required for everything else). */
  uvAvailable: boolean;
  uvVersion: string | null;
  /** The venv directory exists and has a python binary. */
  envExists: boolean;
  /** Version of the bundled python scripts (resources/python/VERSION); deps markers are keyed on it. */
  scriptsVersion: string;
  /** Filled in by `python -c` probes once the env exists; null when unknown. */
  pythonVersion: string | null;
  torchVersion: string | null;
  cudaAvailable: boolean | null;
  gpuName: string | null;
  vramTotalBytes: number | null;
  /** The env passes the import probe (torch + worker deps). */
  ready: boolean;
  /** Currently running phase, when a setup is in flight. */
  phase: EnvPhase;
  lastError: string | null;
}

export interface EnvProgressEvent {
  phase: EnvPhase;
  /** 0-100 across the whole setup, best-effort. */
  pct: number;
  message: string;
  /** A raw line from uv / pip, when there is one. */
  line?: string;
}

export type DevicePreference = 'auto' | 'cuda' | 'cpu';
export type PrecisionPreference = 'auto' | 'fp16' | 'fp32';

export interface AppSettings {
  /** Unload the model after this many idle minutes (0 = never). */
  idleUnloadMinutes: number;
  /** Stop the whole python worker (not just unload weights) when idle. */
  stopWorkerWhenIdle: boolean;
  device: DevicePreference;
  /** Pascal cards (GTX 10xx) have no bf16 and slow fp16 kernels for some ops. */
  precision: PrecisionPreference;
  /** Low VRAM mode: cpu-offload conditioners, smaller chunking. */
  lowVram: boolean;
  /** Pipeline used by the Generate view when none has been chosen yet. */
  defaultPipelineId: string | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
  idleUnloadMinutes: 10,
  stopWorkerWhenIdle: false,
  device: 'auto',
  precision: 'auto',
  lowVram: true,
  defaultPipelineId: null,
};
