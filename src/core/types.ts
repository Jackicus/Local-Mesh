import type { EnvProgressEvent, EnvStatus, LocalMeshPaths, AppSettings } from './env';
import type { GenerationState, MeshOp, OutputItem } from './generation';
import type { JobDraft } from './jobs';
import type { LogChannel, LogEntry, LogLevel, LogReadOptions } from './logs';
import type { ModelDownloadProgress, ModelInstallState } from './models';
import type { Pipeline, PipelineSummary } from './pipeline';

export * from './env';
export * from './generation';
export * from './jobs';
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
  /** Bytes of a generated mesh (must live under outputs/ or a job's cache/ directory). */
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

  // Generation queue + python worker.
  //
  // The queue is the app's one workspace: a job is added, edited, reordered,
  // started, edited again once it has a mesh, and finally saved or thrown away.
  // Every one of those verbs is a call here, and every one of them answers with
  // a fresh GenerationState push rather than a return value the caller has to
  // reconcile.
  getGenerationState: () => Promise<GenerationState>;
  /**
   * Add one draft job per image, or a single empty one when given no images.
   * Returns the new job ids, in the order they were appended.
   */
  addJobs: (imagePaths: string[]) => Promise<string[]>;
  /** Change a job's source, image, name, modifiers or format. Refuses once it has started. */
  updateJob: (jobId: string, patch: Partial<JobDraft>) => Promise<boolean>;
  /** Promote every runnable draft to queued and start working down the list. Returns how many. */
  startQueue: () => Promise<number>;
  cancelGeneration: (jobId: string) => Promise<void>;
  /** Move a job to `toIndex` among the jobs that have not started. */
  reorderGeneration: (jobId: string, toIndex: number) => Promise<boolean>;
  /** Delete a job and its cached revisions. Cancels it first if it is still running. */
  removeJob: (jobId: string) => Promise<boolean>;
  /** Point a finished job at another of its revisions — the row's back and forward. */
  setJobCursor: (jobId: string, cursor: number) => Promise<boolean>;
  /**
   * Run one mesh edit on a finished job's current revision and push the result
   * on as a new revision. Rejects while the queue or the worker is busy.
   */
  applyJobEdit: (jobId: string, op: MeshOp) => Promise<boolean>;
  /**
   * Write a finished job's current revision into the outputs folder and drop
   * the job, cache and all. Returns the saved path.
   */
  saveJob: (jobId: string) => Promise<string | null>;
  loadModel: (modelId: string) => Promise<void>;
  unloadModel: () => Promise<void>;
  stopWorker: () => Promise<void>;
  onGenerationState: (callback: (state: GenerationState) => void) => () => void;

  // Outputs
  listOutputs: () => Promise<OutputItem[]>;
  deleteOutput: (path: string) => Promise<boolean>;

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
  GEN_ADD_JOBS: 'gen:addJobs',
  GEN_UPDATE_JOB: 'gen:updateJob',
  GEN_START: 'gen:start',
  GEN_CANCEL: 'gen:cancel',
  GEN_REORDER: 'gen:reorder',
  GEN_REMOVE_JOB: 'gen:removeJob',
  GEN_SET_CURSOR: 'gen:setCursor',
  GEN_APPLY_EDIT: 'gen:applyEdit',
  GEN_SAVE_JOB: 'gen:saveJob',
  GEN_LOAD_MODEL: 'gen:loadModel',
  GEN_UNLOAD_MODEL: 'gen:unloadModel',
  GEN_STOP_WORKER: 'gen:stopWorker',
  GEN_STATE_CHANGED: 'gen:stateChanged',

  OUTPUTS_LIST: 'outputs:list',
  OUTPUTS_DELETE: 'outputs:delete',

  LOGS_READ: 'logs:read',
  LOGS_CLEAR: 'logs:clear',
  LOGS_WRITE: 'logs:write',
  LOGS_ENTRY: 'logs:entry',
} as const;
