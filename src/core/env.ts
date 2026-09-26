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
  outputs: string; // meshes the user has saved; nothing else writes here
  /**
   * One subdirectory per job, holding the generated mesh and every edited
   * revision of it. A job lives here until the user saves it into outputs/ or
   * deletes it, so twenty passes of fine-tuning cost one output file, not
   * twenty.
   */
  cache: string;
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
/**
 * Low-VRAM mode parks conditioners on the CPU and decodes in smaller chunks:
 * the difference between fitting and OOM on an 8 GB card, and a plain slowdown
 * on a 24 GB one. 'auto' decides per load from the card and the model, so a
 * big card gets its speed without anyone finding the switch.
 */
export type LowVramPreference = 'auto' | 'on' | 'off';

/** Auto turns low-VRAM mode on when the card has less than this many times the model's estimate. */
export const LOW_VRAM_HEADROOM = 2;

/**
 * Resolve the preference into what the worker is told. Unknown card size
 * (CPU-only, or the worker not started yet) errs on the side of fitting.
 */
export function resolveLowVram(
  preference: LowVramPreference,
  modelVramGb: number,
  vramTotalBytes: number | null
): boolean {
  if (preference !== 'auto') return preference === 'on';
  if (vramTotalBytes === null || modelVramGb <= 0) return true;
  return vramTotalBytes < modelVramGb * LOW_VRAM_HEADROOM * 1024 ** 3;
}

export interface AppSettings {
  /** Unload the model after this many idle minutes (0 = never). */
  idleUnloadMinutes: number;
  /** Stop the whole python worker (not just unload weights) when idle. */
  stopWorkerWhenIdle: boolean;
  device: DevicePreference;
  /** Pascal cards (GTX 10xx) have no bf16 and slow fp16 kernels for some ops. */
  precision: PrecisionPreference;
  /** Low VRAM mode: see LowVramPreference. */
  lowVram: LowVramPreference;
  /** Pipeline used by the Generate view when none has been chosen yet. */
  defaultPipelineId: string | null;
  /** Model a new job starts on, so the picker is never empty on a fresh row. */
  defaultModelId: string | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
  idleUnloadMinutes: 10,
  stopWorkerWhenIdle: false,
  device: 'auto',
  precision: 'auto',
  lowVram: 'auto',
  defaultPipelineId: null,
  defaultModelId: null,
};
