import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  AppSettings,
  ClaudeMdDir,
  ElectronAPI,
  EnvProgressEvent,
  GenerationJobRequest,
  GenerationState,
  LogChannel,
  LogEntry,
  LogLevel,
  LogReadOptions,
  MeshProcessRequest,
  ModelDownloadProgress,
  Pipeline,
} from '../core/types';
import { IPC_CHANNELS } from '../core/types';

/** Subscribe to a push channel; returns the unsubscribe function. */
function on<T>(channel: string, callback: (payload: T) => void): () => void {
  const subscription = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, subscription);
  return () => {
    ipcRenderer.removeListener(channel, subscription);
  };
}

const electronAPI: ElectronAPI = {
  minimize: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MINIMIZE),
  maximize: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MAXIMIZE),
  close: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_CLOSE),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED),
  onMaximizedChange: (callback) => on<boolean>(IPC_CHANNELS.WINDOW_MAXIMIZED_CHANGE, callback),
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.APP_INFO),

  readClaudeMd: (dir: ClaudeMdDir) => ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_MD_READ, dir),
  writeClaudeMd: (dir: ClaudeMdDir, content: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_MD_WRITE, dir, content),

  getPaths: () => ipcRenderer.invoke(IPC_CHANNELS.PATHS_GET),
  openPath: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_OPEN_PATH, path),
  showItemInFolder: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_SHOW_ITEM, path),
  openExternal: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, url),
  pickImages: () => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_PICK_IMAGES),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  readImageDataUrl: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_READ_IMAGE_DATA_URL, path),
  readOutputFile: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_READ_OUTPUT, path),

  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
  setSettings: (patch: Partial<AppSettings>) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, patch),

  getEnvStatus: () => ipcRenderer.invoke(IPC_CHANNELS.ENV_STATUS),
  setupEnv: () => ipcRenderer.invoke(IPC_CHANNELS.ENV_SETUP),
  cancelEnvSetup: () => ipcRenderer.invoke(IPC_CHANNELS.ENV_CANCEL),
  removeEnv: () => ipcRenderer.invoke(IPC_CHANNELS.ENV_REMOVE),
  onEnvProgress: (callback) => on<EnvProgressEvent>(IPC_CHANNELS.ENV_PROGRESS, callback),

  listModels: () => ipcRenderer.invoke(IPC_CHANNELS.MODELS_LIST),
  downloadModel: (modelId: string) => ipcRenderer.invoke(IPC_CHANNELS.MODELS_DOWNLOAD, modelId),
  installModelDeps: (modelId: string) => ipcRenderer.invoke(IPC_CHANNELS.MODELS_INSTALL_DEPS, modelId),
  cancelModelDownload: (modelId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.MODELS_CANCEL_DOWNLOAD, modelId),
  deleteModel: (modelId: string) => ipcRenderer.invoke(IPC_CHANNELS.MODELS_DELETE, modelId),
  onModelDownloadProgress: (callback) =>
    on<ModelDownloadProgress>(IPC_CHANNELS.MODELS_DOWNLOAD_PROGRESS, callback),

  listPipelines: () => ipcRenderer.invoke(IPC_CHANNELS.PIPELINES_LIST),
  readPipeline: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.PIPELINES_READ, id),
  writePipeline: (pipeline: Pipeline) => ipcRenderer.invoke(IPC_CHANNELS.PIPELINES_WRITE, pipeline),
  deletePipeline: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.PIPELINES_DELETE, id),

  getGenerationState: () => ipcRenderer.invoke(IPC_CHANNELS.GEN_STATE),
  enqueueGeneration: (request: GenerationJobRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.GEN_ENQUEUE, request),
  cancelGeneration: (jobId: string) => ipcRenderer.invoke(IPC_CHANNELS.GEN_CANCEL, jobId),
  clearFinishedJobs: () => ipcRenderer.invoke(IPC_CHANNELS.GEN_CLEAR_FINISHED),
  loadModel: (modelId: string) => ipcRenderer.invoke(IPC_CHANNELS.GEN_LOAD_MODEL, modelId),
  unloadModel: () => ipcRenderer.invoke(IPC_CHANNELS.GEN_UNLOAD_MODEL),
  stopWorker: () => ipcRenderer.invoke(IPC_CHANNELS.GEN_STOP_WORKER),
  onGenerationState: (callback) => on<GenerationState>(IPC_CHANNELS.GEN_STATE_CHANGED, callback),

  listOutputs: () => ipcRenderer.invoke(IPC_CHANNELS.OUTPUTS_LIST),
  deleteOutput: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.OUTPUTS_DELETE, path),
  processMesh: (request: MeshProcessRequest) => ipcRenderer.invoke(IPC_CHANNELS.OUTPUTS_PROCESS, request),

  readLogs: (channel: LogChannel, options?: LogReadOptions) =>
    ipcRenderer.invoke(IPC_CHANNELS.LOGS_READ, channel, options ?? {}),
  clearLogs: (channel: LogChannel) => ipcRenderer.invoke(IPC_CHANNELS.LOGS_CLEAR, channel),
  log: (level: LogLevel, message: string, channel: LogChannel = 'general') =>
    ipcRenderer.send(IPC_CHANNELS.LOGS_WRITE, level, message, channel),
  onLogEntry: (callback) => on<LogEntry>(IPC_CHANNELS.LOGS_ENTRY, callback),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
