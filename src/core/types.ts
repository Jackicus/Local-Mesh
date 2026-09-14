import type { EnvProgressEvent, EnvStatus, LocalMeshPaths, AppSettings } from './env';
import type {
  GenerationJobRequest,
  GenerationState,
  MeshProcessRequest,
  MeshProcessResult,
  OutputItem,
} from './generation';
import type { LogChannel, LogEntry, LogLevel, LogReadOptions } from './logs';
import type { ModelDownloadProgress, ModelInstallState } from './models';
import type { Pipeline, PipelineSummary } from './pipeline';

export * from './env';
export * from './generation';
export * from './logs';
export * from './models';
export * from './pipeline';

export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
}

/**
 * Everything the renderer can ask the main process for. Implemented in
 * preload/preload.ts (thin ipcRenderer wrappers) and main/ (handlers).
 * Every `on*` subscription returns an unsubscribe function.
 */
export interface ElectronAPI {
  // Window chrome
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  onMaximizedChange: (callback: (isMaximized: boolean) => void) => () => void;
  getAppInfo: () => Promise<AppInfo>;

  // Dev-only CLAUDE.md editing
  readClaudeMd: (dir: ClaudeMdDir) => Promise<string | null>;
  writeClaudeMd: (dir: ClaudeMdDir, content: string) => Promise<boolean>;

  // ~/.local-mesh layout, shell helpers, file dialogs
  getPaths: () => Promise<LocalMeshPaths>;
  openPath: (path: string) => Promise<void>;
  showItemInFolder: (path: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  pickImages: () => Promise<string[]>;
  /** Absolute path of a File dropped onto the window (Electron's webUtils). */
  getPathForFile: (file: File) => string;
  /** Data URL (image/*), or null if unreadable / not an image / over 20MB. */
  readImageDataUrl: (path: string) => Promise<string | null>;
  /** Bytes of a generated mesh (must live under outputs/). */
  readOutputFile: (path: string) => Promise<ArrayBuffer | null>;

  // Settings
  getSettings: () => Promise<AppSettings>;
  setSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;

  // Python environment (uv-managed venv + scripts in ~/.local-mesh)
  getEnvStatus: () => Promise<EnvStatus>;
  setupEnv: () => Promise<void>;
  cancelEnvSetup: () => Promise<void>;
  removeEnv: () => Promise<void>;
  onEnvProgress: (callback: (event: EnvProgressEvent) => void) => () => void;

  // Models: weights come straight from Hugging Face (no python needed);
  // per-model python deps are a separate step that needs the env.
  listModels: () => Promise<ModelInstallState[]>;
  downloadModel: (modelId: string) => Promise<void>;
  installModelDeps: (modelId: string) => Promise<void>;
  /** Cancels whichever of download / install is running for the model. */
  cancelModelDownload: (modelId: string) => Promise<void>;
  deleteModel: (modelId: string) => Promise<void>;
  onModelDownloadProgress: (callback: (event: ModelDownloadProgress) => void) => () => void;

  // Pipelines (node graphs saved as JSON in ~/.local-mesh/pipelines)
  listPipelines: () => Promise<PipelineSummary[]>;
  readPipeline: (id: string) => Promise<Pipeline | null>;
  writePipeline: (pipeline: Pipeline) => Promise<boolean>;
  deletePipeline: (id: string) => Promise<boolean>;

  // Generation queue + python worker
  getGenerationState: () => Promise<GenerationState>;
  enqueueGeneration: (request: GenerationJobRequest) => Promise<string[]>;
  cancelGeneration: (jobId: string) => Promise<void>;
  clearFinishedJobs: () => Promise<void>;
  loadModel: (modelId: string) => Promise<void>;
  unloadModel: () => Promise<void>;
  stopWorker: () => Promise<void>;
  onGenerationState: (callback: (state: GenerationState) => void) => () => void;

  // Outputs
  listOutputs: () => Promise<OutputItem[]>;
  deleteOutput: (path: string) => Promise<boolean>;
  /** Reduce / smooth an existing output via the worker; writes a new file next to it. Rejects while a job is running. */
  processMesh: (request: MeshProcessRequest) => Promise<MeshProcessResult>;

  // Logs
  readLogs: (channel: LogChannel, options?: LogReadOptions) => Promise<LogEntry[]>;
  clearLogs: (channel: LogChannel) => Promise<void>;
  /** Fire-and-forget: renderer-side logging lands in the same files. */
  log: (level: LogLevel, message: string, channel?: LogChannel) => void;
  onLogEntry: (callback: (entry: LogEntry) => void) => () => void;
}

// src/ui directories whose CLAUDE.md the Developer view can read/write (dev only).
// The main process validates against this list so the renderer can never name a path.
export const CLAUDE_MD_DIRS = [
  'assets',
  'components',
  'hooks',
  'shell',
  'stores',
  'views',
] as const;

export type ClaudeMdDir = (typeof CLAUDE_MD_DIRS)[number];

export const IPC_CHANNELS = {
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:isMaximized',
  WINDOW_MAXIMIZED_CHANGE: 'window:maximized-change',
  APP_INFO: 'app:info',
  CLAUDE_MD_READ: 'claudemd:read',
  CLAUDE_MD_WRITE: 'claudemd:write',

  PATHS_GET: 'paths:get',
  SHELL_OPEN_PATH: 'shell:openPath',
  SHELL_SHOW_ITEM: 'shell:showItemInFolder',
  SHELL_OPEN_EXTERNAL: 'shell:openExternal',
  DIALOG_PICK_IMAGES: 'dialog:pickImages',
  FILE_READ_IMAGE_DATA_URL: 'file:readImageDataUrl',
  FILE_READ_OUTPUT: 'file:readOutput',

  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',

  ENV_STATUS: 'env:status',
  ENV_SETUP: 'env:setup',
  ENV_CANCEL: 'env:cancel',
  ENV_REMOVE: 'env:remove',
  ENV_PROGRESS: 'env:progress',

  MODELS_LIST: 'models:list',
  MODELS_DOWNLOAD: 'models:download',
  MODELS_INSTALL_DEPS: 'models:installDeps',
  MODELS_CANCEL_DOWNLOAD: 'models:cancelDownload',
  MODELS_DELETE: 'models:delete',
  MODELS_DOWNLOAD_PROGRESS: 'models:downloadProgress',

  PIPELINES_LIST: 'pipelines:list',
  PIPELINES_READ: 'pipelines:read',
  PIPELINES_WRITE: 'pipelines:write',
  PIPELINES_DELETE: 'pipelines:delete',

  GEN_STATE: 'gen:state',
  GEN_ENQUEUE: 'gen:enqueue',
  GEN_CANCEL: 'gen:cancel',
  GEN_CLEAR_FINISHED: 'gen:clearFinished',
  GEN_LOAD_MODEL: 'gen:loadModel',
  GEN_UNLOAD_MODEL: 'gen:unloadModel',
  GEN_STOP_WORKER: 'gen:stopWorker',
  GEN_STATE_CHANGED: 'gen:stateChanged',

  OUTPUTS_LIST: 'outputs:list',
  OUTPUTS_DELETE: 'outputs:delete',
  OUTPUTS_PROCESS: 'outputs:process',

  LOGS_READ: 'logs:read',
  LOGS_CLEAR: 'logs:clear',
  LOGS_WRITE: 'logs:write',
  LOGS_ENTRY: 'logs:entry',
} as const;
