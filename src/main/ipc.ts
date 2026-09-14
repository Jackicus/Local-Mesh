import { ipcMain } from 'electron';
import { IPC_CHANNELS, LOG_CHANNELS, LOG_LEVELS } from '../core/types';
import type {
  AppSettings,
  GenerationJobRequest,
  LogChannel,
  LogLevel,
  LogReadOptions,
  MeshProcessRequest,
  Pipeline,
} from '../core/types';
import {
  cancelEnvSetup,
  getEnvStatus,
  invalidateProbe,
  removeEnv,
  setupEnv,
} from './envManager';
import { clearLogs, log, readLogs, write as writeLog } from './logger';
import {
  cancelModelDownload,
  deleteModel,
  downloadModel,
  installModelDeps,
  listModels,
} from './modelManager';
import { deleteOutput, listOutputs } from './outputs';
import {
  getPaths,
  openExternal,
  openPath,
  pickImages,
  readImageDataUrl,
  readOutputFile,
  showItemInFolder,
} from './paths';
import { deletePipeline, listPipelines, readPipeline, writePipeline } from './pipelines';
import { errorMessage } from './proc';
import {
  cancelGeneration,
  clearFinishedJobs,
  enqueue,
  loadModel,
  onSettingsChanged,
  processMesh,
  stopWorker,
  unloadModel,
} from './queue';
import { getState } from './queueState';
import { getSettings, setSettings } from './settings';

/**
 * Every renderer-facing handler in one place. Each one rethrows a plain,
 * readable Error so the renderer never sees an internal stack, and logs the
 * failure to the general channel (which mirrors it into errors.log).
 */

function handle<Args extends unknown[], Result>(
  channel: string,
  fn: (...args: Args) => Result | Promise<Result>
): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<Result> => {
    try {
      return await fn(...(args as Args));
    } catch (err) {
      const message = errorMessage(err);
      log.general.error(`${channel}: ${message}`);
      throw new Error(message);
    }
  });
}

export function registerAllHandlers(): void {
  // ~/.local-mesh layout, shell helpers, file dialogs
  handle(IPC_CHANNELS.PATHS_GET, () => getPaths());
  handle(IPC_CHANNELS.SHELL_OPEN_PATH, (target: string) => openPath(target));
  handle(IPC_CHANNELS.SHELL_SHOW_ITEM, (target: string) => showItemInFolder(target));
  handle(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, (url: string) => openExternal(url));
  handle(IPC_CHANNELS.DIALOG_PICK_IMAGES, () => pickImages());
  handle(IPC_CHANNELS.FILE_READ_IMAGE_DATA_URL, (file: string) => readImageDataUrl(file));
  handle(IPC_CHANNELS.FILE_READ_OUTPUT, (file: string) => readOutputFile(file));

  // Settings
  handle(IPC_CHANNELS.SETTINGS_GET, () => getSettings());
  handle(IPC_CHANNELS.SETTINGS_SET, (patch: Partial<AppSettings>) => {
    const next = setSettings(patch);
    onSettingsChanged();
    return next;
  });

  // Python environment
  handle(IPC_CHANNELS.ENV_STATUS, () => getEnvStatus());
  handle(IPC_CHANNELS.ENV_SETUP, () => setupEnv());
  handle(IPC_CHANNELS.ENV_CANCEL, () => cancelEnvSetup());
  handle(IPC_CHANNELS.ENV_REMOVE, async () => {
    // Weights survive, but everything the worker needs is about to disappear.
    await stopWorker(true);
    removeEnv();
    invalidateProbe();
  });

  // Models
  handle(IPC_CHANNELS.MODELS_LIST, () => listModels());
  handle(IPC_CHANNELS.MODELS_DOWNLOAD, (modelId: string) => downloadModel(modelId));
  handle(IPC_CHANNELS.MODELS_INSTALL_DEPS, (modelId: string) => installModelDeps(modelId));
  handle(IPC_CHANNELS.MODELS_CANCEL_DOWNLOAD, (modelId: string) => cancelModelDownload(modelId));
  handle(IPC_CHANNELS.MODELS_DELETE, (modelId: string) => deleteModel(modelId));

  // Pipelines
  handle(IPC_CHANNELS.PIPELINES_LIST, () => listPipelines());
  handle(IPC_CHANNELS.PIPELINES_READ, (id: string) => readPipeline(id));
  handle(IPC_CHANNELS.PIPELINES_WRITE, (pipeline: Pipeline) => writePipeline(pipeline));
  handle(IPC_CHANNELS.PIPELINES_DELETE, (id: string) => deletePipeline(id));

  // Generation queue
  handle(IPC_CHANNELS.GEN_STATE, () => getState());
  handle(IPC_CHANNELS.GEN_ENQUEUE, (request: GenerationJobRequest) => enqueue(request));
  handle(IPC_CHANNELS.GEN_CANCEL, (jobId: string) => cancelGeneration(jobId));
  handle(IPC_CHANNELS.GEN_CLEAR_FINISHED, () => clearFinishedJobs());
  handle(IPC_CHANNELS.GEN_LOAD_MODEL, (modelId: string) => loadModel(modelId));
  handle(IPC_CHANNELS.GEN_UNLOAD_MODEL, () => unloadModel());
  handle(IPC_CHANNELS.GEN_STOP_WORKER, () => stopWorker(true));

  // Outputs
  handle(IPC_CHANNELS.OUTPUTS_LIST, () => listOutputs());
  handle(IPC_CHANNELS.OUTPUTS_DELETE, (file: string) => deleteOutput(file));
  handle(IPC_CHANNELS.OUTPUTS_PROCESS, (request: MeshProcessRequest) => processMesh(request));

  // Logs
  handle(IPC_CHANNELS.LOGS_READ, (channel: LogChannel, options?: LogReadOptions) =>
    readLogs(channel, options ?? {})
  );
  handle(IPC_CHANNELS.LOGS_CLEAR, (channel: LogChannel) => clearLogs(channel));

  // Fire-and-forget from the renderer; validated because it is a `send`, not an `invoke`.
  ipcMain.on(IPC_CHANNELS.LOGS_WRITE, (_event, level: LogLevel, message: string, channel: LogChannel) => {
    if (!LOG_LEVELS.includes(level) || !LOG_CHANNELS.includes(channel)) return;
    writeLog({ channel, level, source: 'renderer', message: String(message) });
  });
}
