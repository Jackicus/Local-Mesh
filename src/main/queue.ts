import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  compileModelJob,
  compilePipeline,
  currentRevision,
  describeMeshOp,
  emptyDraft,
  getModel,
  imageStem,
  isPending,
  jobBlocker,
  jobStem,
  jobTitle,
  MESH_OP_DEFINITIONS,
  MODELS,
  newId,
  normalizeDraft,
  normalizeMeshOp,
  validatePipeline,
  withModifiers,
} from '../core/types';
import type {
  GenerationJob,
  GenerationJobSpec,
  JobCompileContext,
  JobDraft,
  MeshGeneratorData,
  MeshOp,
  WorkerEvent,
} from '../core/types';
import { envPython, isEnvUsable } from './envManager';
import { formatBytes, formatDuration, plural, since } from './format';
import { log, reported } from './logger';
import { getModelInstallState, listModels, modelDir } from './modelManager';
import { getPaths, isInside } from './paths';
import { listPipelines, readPipeline } from './pipelines';
import { CancelledError, errorMessage, isCancelled } from './proc';
import { getSettings } from './settings';
import {
  broadcast,
  dropJob,
  findJob,
  flushJobs,
  isBusy,
  isFinished,
  state,
  stopBroadcasts,
  trimJobs,
} from './jobStore';
import { WorkerProcess } from './worker';

export { getState, isBusy, isModelLoaded, reorderQueue } from './jobStore';

/**
 * The generation queue: one job at a time through one python worker, which
 * keeps a model resident between jobs. Every transition writes the shared
 * GenerationState and broadcasts a snapshot.
 *
 * The queue is also the app's workspace, not just its runner. A job is added
 * as a draft, edited, reordered, started, edited again once it has a mesh, and
 * finally saved into outputs/ or thrown away — every one of those verbs is an
 * export here. Two consequences run through the whole file:
 *
 *  - A job's worker spec is compiled when it *starts*, not when it is added,
 *    so everything about it stays editable right up to that moment.
 *  - Generation writes into the job's own cache/<jobId>/ directory. Only
 *    saveJob() puts a file in outputs/, which is what makes twenty passes of
 *    fine editing cost one output file rather than twenty.
 */

const WORKER_START_MS = 180_000;
const LOAD_TIMEOUT_MS = 30 * 60_000;
const UNLOAD_TIMEOUT_MS = 120_000;
/** How long a soft cancel gets before the worker is killed outright. */
const HARD_CANCEL_MS = 8000;

const glog = log.generation;
/** Worker-authored lines keep source 'worker' so the Logs view can filter them. */
const wlog = log.for('worker', 'generation');

let worker: WorkerProcess | null = null;
/** In-flight start / stop, so the two can never overlap or run twice at once. */
let startPromise: Promise<WorkerProcess> | null = null;
let stopPromise: Promise<void> | null = null;
let pumping = false;
let stopping = false;
let idleTimer: NodeJS.Timeout | null = null;
let hardCancelTimer: NodeJS.Timeout | null = null;
const cancelRequests = new Set<string>();

type TerminalEvent = Extract<WorkerEvent, { event: 'done' | 'cancelled' | 'error' }>;

// ---------------------------------------------------------------------------
// Worker lifecycle
// ---------------------------------------------------------------------------

/**
 * True when no in-flight call is waiting to turn a worker `error` event into a
 * failed job, a failed load or a rejected request — i.e. when an error would
 * otherwise vanish without ever being logged.
 */
function nothingAwaitingWorker(): boolean {
  return (
    !state.activeJobId &&
    !state.processing &&
    state.worker !== 'loading' &&
    state.worker !== 'unloading' &&
    state.worker !== 'starting'
  );
}

function onWorkerEvent(event: WorkerEvent): void {
  switch (event.event) {
    case 'log':
      wlog[event.level](event.message, event.job_id);
      break;
    case 'progress': {
      // A `process` request reports under its request id, not a job id.
      if (state.processing && event.job_id === state.processing.requestId) {
        state.processing = {
          ...state.processing,
          pct: event.pct,
          stage: event.stage,
          message: event.message,
        };
        // Mirror it onto the job as well: the edit belongs to a row, and the
        // row is where the user is looking while it runs.
        const edited = findJob(state.processing.jobId);
        if (edited?.editing) {
          edited.editing = { ...edited.editing, pct: event.pct, message: event.message };
        }
        broadcast();
        return;
      }
      // Model-load progress carries an empty job_id (see PROTOCOL.md); show it
      // on the job that is waiting for that load, if there is one.
      const job = event.job_id
        ? findJob(event.job_id)
        : state.jobs.find((j) => j.id === state.activeJobId && j.status === 'loading');
      if (!job || isFinished(job)) return;
      job.progress = { pct: event.pct, stage: event.stage, message: event.message };
      broadcast();
      break;
    }
    case 'error': {
      // The message itself reaches the log through whatever awaited this event
      // (markFailed, or the caller that threw). Two things do not: the python
      // traceback, which is the only way to debug a backend, and an error that
      // arrives with nothing waiting to attribute it.
      const id = event.job_id ?? event.request_id;
      if (event.traceback) wlog.debug(`python traceback:\n${event.traceback.trim()}`, id);
      if (!id && nothingAwaitingWorker()) wlog.error(`worker error: ${event.message}`);
      break;
    }
    case 'memory':
      state.memory = {
        vramUsedBytes: event.vram_used,
        vramTotalBytes: event.vram_total,
        ramUsedBytes: event.ram_used,
        sampledAt: Date.now(),
      };
      broadcast();
      break;
    default:
      // ready / loaded / unloaded / done / cancelled / error / pong are awaited
      // by the call that provoked them.
      break;
  }
}

function onWorkerExit(instance: WorkerProcess, code: number | null, signal: NodeJS.Signals | null): void {
  if (worker !== instance) return;
  worker = null;
  state.loadedModelId = null;
  state.loadingModelId = null;
  state.idleUnloadAt = null;
  clearIdleTimer();

  const detail = `code ${code ?? 'null'}${signal ? `, ${signal}` : ''}`;
  const job = state.activeJobId ? findJob(state.activeJobId) : undefined;
  if (job && !isFinished(job)) {
    if (cancelRequests.has(job.id)) {
      markCancelled(job);
      state.worker = 'stopped';
      state.workerError = null;
      glog.info(`worker stopped to honour the cancel (${detail})`);
    } else {
      // markFailed records the error against the job, with the same detail in
      // it — a second error line here would be the same event logged twice.
      markFailed(job, `The python worker exited unexpectedly (${detail}).`);
      state.worker = 'error';
      state.workerError = `Worker exited (${detail}).`;
    }
  } else if (stopping || code === 0) {
    state.worker = 'stopped';
    state.workerError = null;
    glog.info(`worker stopped (${detail})`);
  } else {
    state.worker = 'error';
    state.workerError = `Worker exited (${detail}).`;
    glog.error(
      `worker exited unexpectedly while idle (${detail}); it will be restarted for the next job. ` +
        'A kill like this is usually the OS running out of RAM.'
    );
  }
  broadcast(true);
}

/**
 * Start the worker at most once, however many callers ask at the same time, and
 * never on top of a stop that is still finishing.
 *
 * Two concurrent `ensureWorker()` calls (two Load buttons, a job starting while
 * the Models view loads a model) each used to spawn a python process and the
 * second overwrote `worker` — the first was then orphaned, holding its VRAM,
 * with nothing left that could ever stop it. And a start racing the idle
 * `stopWorker(true)` would hand back the instance that was already shutting
 * down, so the next command went to a dying process.
 */
async function ensureWorker(): Promise<WorkerProcess> {
  if (stopPromise) await stopPromise;
  if (worker?.alive) return worker;
  if (startPromise) return startPromise;
  startPromise = startWorker();
  try {
    return await startPromise;
  } finally {
    startPromise = null;
  }
}

async function startWorker(): Promise<WorkerProcess> {
  if (!isEnvUsable()) {
    throw new Error('The Python environment is not set up yet. Run Setup in the Environment view.');
  }
  const paths = getPaths();
  state.worker = 'starting';
  state.workerError = null;
  broadcast(true);

  const instance = new WorkerProcess({ python: envPython(), scriptsDir: paths.scripts, root: paths.root });
  worker = instance;
  instance.on('event', onWorkerEvent);
  instance.on('exit', (info: { code: number | null; signal: NodeJS.Signals | null }) =>
    onWorkerExit(instance, info.code, info.signal)
  );
  glog.info(`worker starting (pid ${instance.pid ?? '?'})`);
  const startedAt = Date.now();

  try {
    const ready = await instance.waitFor((e) => e.event === 'ready', WORKER_START_MS, 'worker startup');
    if (ready.event === 'ready') {
      state.memory = { ...state.memory, vramTotalBytes: ready.vram_total, sampledAt: Date.now() };
      const gpu = ready.gpu
        ? ` (${ready.gpu}${ready.vram_total ? `, ${formatBytes(ready.vram_total)}` : ''})`
        : '';
      glog.info(
        `worker ready in ${since(startedAt)}: python ${ready.python}, ` +
          `torch ${ready.torch ?? 'missing'}, cuda ${ready.cuda}${gpu}`
      );
    }
  } catch (err) {
    const message = errorMessage(err);
    // The job path logs this against the job; every other caller unwinds to an
    // IPC handler that logs it. Only the kill is worth a line of its own.
    glog.warn(`worker startup failed after ${since(startedAt)}; killing pid ${instance.pid ?? '?'}`);
    // `stopping` marks the kill as ours, so onWorkerExit doesn't report it as a
    // crash — and doesn't overwrite the startup error with "Worker exited".
    stopping = true;
    try {
      await instance.stop(false);
    } finally {
      stopping = false;
    }
    state.worker = 'error';
    state.workerError = message;
    broadcast(true);
    throw new Error(message);
  }
  state.worker = 'idle';
  state.loadedModelId = null;
  broadcast(true);
  return instance;
}

async function unloadInternal(instance: WorkerProcess): Promise<void> {
  if (!state.loadedModelId) return;
  const previous = state.loadedModelId;
  const startedAt = Date.now();
  state.worker = 'unloading';
  broadcast(true);
  try {
    instance.send({ cmd: 'unload' });
    const event = await instance.waitFor(
      (e) => e.event === 'unloaded' || e.event === 'error',
      UNLOAD_TIMEOUT_MS,
      'unload'
    );
    // Either way the model is dropped on our side; the VRAM may not come back
    // until the worker restarts, which is degraded rather than broken.
    if (event.event === 'error') glog.warn(`${previous} did not unload cleanly: ${event.message}`);
  } catch (err) {
    glog.warn(`${previous} did not unload cleanly: ${errorMessage(err)}`);
  }
  state.loadedModelId = null;
  if (state.worker === 'unloading') state.worker = 'idle';
  glog.info(`unloaded ${previous} in ${since(startedAt)}`);
  broadcast(true);
}

async function loadInternal(instance: WorkerProcess, modelId: string): Promise<void> {
  const model = getModel(modelId);
  if (!model) throw new Error(`Unknown model "${modelId}".`);
  if (!getModelInstallState(modelId).ready) {
    throw new Error(`${model.name} is not installed yet. Download it from the Models view first.`);
  }
  if (state.loadedModelId && state.loadedModelId !== modelId) await unloadInternal(instance);

  const settings = getSettings();
  state.worker = 'loading';
  state.loadingModelId = modelId;
  state.device = settings.device;
  state.precision = settings.precision;
  broadcast(true);
  glog.info(
    `loading ${modelId} (device ${settings.device}, precision ${settings.precision}, low-vram ${settings.lowVram})`
  );

  try {
    instance.send({
      cmd: 'load',
      model_id: modelId,
      model_dir: modelDir(modelId),
      device: settings.device,
      precision: settings.precision,
      low_vram: settings.lowVram,
    });
    const event = await instance.waitFor(
      (e) => e.event === 'loaded' || e.event === 'error',
      LOAD_TIMEOUT_MS,
      `loading ${model.name}`
    );
    if (event.event === 'error') throw new Error(formatWorkerError(event));
    if (event.event === 'loaded') glog.info(`loaded ${modelId} in ${formatDuration(event.duration_ms)}`);
  } catch (err) {
    // Leaving `worker` at 'loading' would make isBusy() true forever, and every
    // later load, unload or job would be refused as "the queue is busy". Only
    // runJob used to unwind this; loadModel() from the Models view did not.
    state.loadingModelId = null;
    if (state.worker === 'loading') state.worker = worker?.alive ? 'idle' : 'stopped';
    broadcast(true);
    throw err;
  } finally {
    state.loadingModelId = null;
  }
  state.loadedModelId = modelId;
  state.worker = 'idle';
  broadcast(true);
}

/** Resolve when the worker reports a terminal event for `job`. */
function awaitGenerate(instance: WorkerProcess, job: GenerationJob): Promise<TerminalEvent> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      instance.off('event', onEvent);
      instance.off('exit', onExit);
    };
    const onEvent = (event: WorkerEvent) => {
      const matches =
        (event.event === 'done' || event.event === 'cancelled') && event.job_id === job.id
          ? true
          : event.event === 'error' && (!event.job_id || event.job_id === job.id);
      if (!matches) return;
      cleanup();
      resolve(event as TerminalEvent);
    };
    const onExit = () => {
      cleanup();
      reject(new Error('The python worker exited during generation.'));
    };
    instance.on('event', onEvent);
    instance.on('exit', onExit);
  });
}

function formatWorkerError(event: Extract<WorkerEvent, { event: 'error' }>): string {
  if (!event.oom) return event.message;
  return `${event.message}\nOut of VRAM. Try a lower octree / marching-cubes resolution, enable low-VRAM mode in Settings, or pick a smaller model.`;
}

// ---------------------------------------------------------------------------
// Job transitions
// ---------------------------------------------------------------------------

/** How long the job has been alive, for the line that closes it out. */
function jobElapsed(job: GenerationJob): string {
  return since(job.runningAt ?? job.startedAt ?? job.createdAt);
}

function markDone(job: GenerationJob, event: Extract<WorkerEvent, { event: 'done' }>): void {
  job.status = 'done';
  job.finishedAt = Date.now();
  // The generated mesh is revision 0; every edit from here pushes another one
  // after it, and the cursor is what the viewer and Save both read.
  job.revisions = [
    { path: event.output, op: null, vertices: event.vertices, faces: event.faces, createdAt: Date.now() },
  ];
  job.cursor = 0;
  job.progress = { pct: 100, stage: 'export', message: 'Done' };
  let size = 0;
  try {
    size = fs.statSync(event.output).size;
  } catch {
    // The worker just wrote it; if it is already gone, the line loses a size.
  }
  const about = [`${event.vertices} verts`, `${event.faces} faces`];
  if (size) about.push(formatBytes(size));
  glog.info(
    `done in ${formatDuration(event.duration_ms)} → ${path.basename(event.output)} (${about.join(', ')})`,
    job.id
  );
}

function markFailed(job: GenerationJob, message: string): void {
  job.status = 'failed';
  job.finishedAt = Date.now();
  job.error = message;
  glog.error(`failed after ${jobElapsed(job)}: ${message}`, job.id);
}

function markCancelled(job: GenerationJob): void {
  const queued = job.status === 'queued';
  job.status = 'cancelled';
  job.finishedAt = Date.now();
  // A cancel is what the user asked for, not a degraded outcome.
  glog.info(queued ? 'cancelled before it started' : `cancelled after ${jobElapsed(job)}`, job.id);
}

// ---------------------------------------------------------------------------
// Idle unload
// ---------------------------------------------------------------------------

function clearIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

function scheduleIdleUnload(): void {
  clearIdleTimer();
  const { idleUnloadMinutes, stopWorkerWhenIdle } = getSettings();
  const nothingToRelease = !state.loadedModelId && !stopWorkerWhenIdle;
  if (!worker?.alive || idleUnloadMinutes <= 0 || isBusy() || nothingToRelease) {
    state.idleUnloadAt = null;
    broadcast();
    return;
  }
  const delay = idleUnloadMinutes * 60_000;
  state.idleUnloadAt = Date.now() + delay;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    void onIdle();
  }, delay);
  broadcast();
}

async function onIdle(): Promise<void> {
  if (isBusy()) {
    scheduleIdleUnload();
    return;
  }
  state.idleUnloadAt = null;
  const settings = getSettings();
  const idle = `idle for ${settings.idleUnloadMinutes}m`;
  try {
    if (settings.stopWorkerWhenIdle) {
      glog.info(`${idle}: stopping the worker to release its memory`);
      await stopWorker();
    } else if (worker?.alive && state.loadedModelId) {
      glog.info(`${idle}: unloading ${state.loadedModelId} to release its VRAM`);
      await unloadInternal(worker);
    }
  } catch (err) {
    glog.warn(`could not release memory after the idle timeout: ${errorMessage(err)}`);
  }
  // Re-arm: a job may have been queued while the release was in flight, and a
  // release that did not take (an unload the worker refused) should be retried
  // rather than leaving memory held with no timer left to free it.
  scheduleIdleUnload();
  broadcast(true);
}

// ---------------------------------------------------------------------------
// Building jobs
// ---------------------------------------------------------------------------

/** Model ids that could actually run right now. */
function installedModelIds(): Set<string> {
  return new Set(listModels().filter((m) => m.ready).map((m) => m.id));
}

/**
 * What a brand-new row starts on. The user's choice first; failing that the
 * first real model that is actually installed, so a fresh install lands on
 * something runnable rather than on an empty picker; failing that, the model
 * the registry recommends, installed or not — the row then says it is not
 * installed and points at Models, which is the whole of the first-run prompt.
 *
 * The test shape is never picked here. It is always "ready", so it used to be
 * what a first picture landed on, and a first Start that answers a photo with
 * a torus knot reads as the app being broken.
 */
export function defaultModelId(): string | null {
  const preferred = getSettings().defaultModelId;
  if (preferred && getModel(preferred)) return preferred;
  const installed = listModels().find((m) => m.ready && getModel(m.id)?.hfRepo);
  if (installed) return installed.id;
  return MODELS.find((m) => m.tags.includes('recommended'))?.id ?? null;
}

function jobDirs(jobId: string): { inputDir: string; cacheDir: string } {
  const paths = getPaths();
  const inputDir = path.join(paths.inputs, jobId);
  const cacheDir = path.join(paths.cache, jobId);
  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  return { inputDir, cacheDir };
}

/**
 * Take the job's own copy of an image. A job outlives whatever the user dropped
 * on the window — they move it, rename it, empty the folder — and the copy is
 * what makes the row still work an hour later.
 */
function adoptImage(jobId: string, source: string): string {
  const { inputDir } = jobDirs(jobId);
  const target = path.join(inputDir, path.basename(source));
  fs.copyFileSync(source, target);
  return target;
}

/** `stem.ext`, then `stem-2.ext`, `stem-3.ext` — the worker's convention (unique_path). */
function uniquePath(dir: string, stem: string, ext: string): string {
  fs.mkdirSync(dir, { recursive: true });
  let candidate = path.join(dir, `${stem}.${ext}`);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem}-${index}.${ext}`);
    index += 1;
  }
  return candidate;
}

/**
 * One draft job per image, or a single empty one when given none (the `+` above
 * the queue). Every source is checked before anything is created, so a bad path
 * cannot leave half a batch behind.
 */
export function addJobs(imagePaths: string[]): string[] {
  const sources = Array.isArray(imagePaths) ? imagePaths.filter((p) => typeof p === 'string' && p) : [];
  const missing = sources.filter((p) => !fs.existsSync(p));
  if (missing.length) throw new Error(`Image not found: ${missing.map((p) => path.basename(p)).join(', ')}`);

  const modelId = defaultModelId();
  const ids: string[] = [];
  // No images means one empty row waiting for one.
  const slots: (string | null)[] = sources.length ? sources : [null];

  for (const source of slots) {
    const jobId = newId('job');
    const { cacheDir } = jobDirs(jobId);
    const copied = source ? adoptImage(jobId, source) : null;
    const draft: JobDraft = { ...emptyDraft(modelId), imagePath: source };
    const job: GenerationJob = {
      id: jobId,
      draft,
      imagePath: copied,
      imageName: copied ? path.basename(copied) : null,
      cacheDir,
      status: 'draft',
      progress: { pct: 0, stage: 'draft', message: '' },
      createdAt: Date.now(),
      revisions: [],
      cursor: 0,
      editing: null,
    };
    state.jobs.push(job);
    ids.push(jobId);
    glog.info(`job added: ${jobTitle(draft)}${modelId ? ` on ${modelId}` : ' with no model chosen'}`, jobId);
  }

  broadcast(true);
  return ids;
}

/**
 * Merge a patch into a job's draft. Everything is editable while the job is
 * still a draft or queued; after that only the name is, because renaming before
 * saving is the whole point of a finished row.
 *
 * The patch is normalised rather than trusted: it arrives over IPC, and a
 * malformed modifier must not be able to reach the worker.
 */
export function updateJob(jobId: string, patch: Partial<JobDraft>): boolean {
  const job = findJob(jobId);
  if (!job || !patch || typeof patch !== 'object') return false;

  if (!isPending(job.status)) {
    if (typeof patch.name !== 'string') return false;
    job.draft = { ...job.draft, name: patch.name };
    broadcast(true);
    return true;
  }

  const previousImage = job.draft.imagePath;
  const next = normalizeDraft({ ...job.draft, ...patch }, defaultModelId());
  if (next.imagePath && next.imagePath !== previousImage && !fs.existsSync(next.imagePath)) {
    // Refuse rather than blank the row: the copy the job already has still
    // works, and half-applying the rest of the patch would be worse.
    throw new Error(`Image not found: ${path.basename(next.imagePath)}`);
  }
  job.draft = next;

  if (next.imagePath !== previousImage) {
    const stale = job.imagePath;
    if (!next.imagePath) {
      job.imagePath = null;
      job.imageName = null;
    } else {
      const copied = adoptImage(job.id, next.imagePath);
      job.imagePath = copied;
      job.imageName = path.basename(copied);
      // The superseded copy is dead weight in the job's input directory.
      if (stale && stale !== copied && isInside(getPaths().inputs, stale)) {
        fs.rmSync(stale, { force: true });
      }
    }
  }

  broadcast(true);
  return true;
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

function resolveSeed(configured: unknown): number {
  const n = typeof configured === 'number' ? configured : Number(configured);
  if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  return crypto.randomInt(0, 0xffffffff);
}

/**
 * Turn a job into a worker spec, at the moment it starts. Doing this here
 * rather than at add time is the point of the whole reshape: the model, its
 * settings, the image, the name and the modifier chain are all still the
 * user's to change until this runs.
 *
 * A pipeline-sourced job compiles its graph first and then stacks the row's own
 * modifiers on the end, so the graph's ops run before the row's.
 */
function compileJob(job: GenerationJob): GenerationJobSpec {
  const draft = job.draft;
  if (!job.imagePath) throw new Error('This job has no image.');
  // The job's own copy, not the file the user picked — but the copy can be gone
  // too, if the inputs folder was emptied between restarts.
  if (!fs.existsSync(job.imagePath)) {
    throw new Error(`This job's image is no longer in the inputs folder (${job.imageName ?? ''}).`);
  }
  const ctx: JobCompileContext = {
    jobId: job.id,
    imagePath: job.imagePath,
    // Never paths.outputs: outputs/ is only ever written by Save.
    outputDir: job.cacheDir,
    seed: 0,
  };

  if (draft.source.kind === 'pipeline') {
    const pipeline = readPipeline(draft.source.pipelineId);
    if (!pipeline) throw new Error(`Pipeline "${draft.source.pipelineId}" could not be read.`);
    const errors = validatePipeline(pipeline).filter((i) => i.level === 'error');
    if (errors.length) throw new Error(errors.map((e) => e.message).join(' '));
    const genNode = pipeline.nodes.find((n) => n.type === 'mesh-generator');
    const seed = resolveSeed((genNode?.data as MeshGeneratorData | undefined)?.settings?.['seed']);
    const spec = compilePipeline(pipeline, {
      jobId: job.id,
      imagePath: job.imagePath,
      imageStem: imageStem(job.imageName ?? job.imagePath),
      outputDir: job.cacheDir,
      pipelineName: pipeline.name,
      seed,
      index: 0,
      now: new Date(),
    });
    return withModifiers(spec, draft, { ...ctx, seed });
  }

  const seed = resolveSeed(draft.source.settings['seed']);
  return compileModelJob(draft, { ...ctx, seed });
}

async function runJob(job: GenerationJob): Promise<void> {
  state.activeJobId = job.id;
  job.startedAt = Date.now();
  job.status = 'loading';
  job.progress = { pct: 0, stage: 'load', message: 'Preparing worker' };
  clearIdleTimer();
  state.idleUnloadAt = null;
  broadcast(true);

  try {
    // Compiled before the worker is touched: a job that cannot be compiled
    // should fail on its own without spinning python up for nothing.
    const spec = compileJob(job);
    job.spec = spec;
    fs.mkdirSync(job.cacheDir, { recursive: true });

    const instance = await ensureWorker();
    if (cancelRequests.has(job.id)) throw new CancelledError();
    if (state.loadedModelId !== spec.modelId) await loadInternal(instance, spec.modelId);
    if (cancelRequests.has(job.id)) throw new CancelledError();

    job.status = 'running';
    job.runningAt = Date.now();
    job.progress = { pct: 0, stage: 'prepare', message: 'Starting' };
    state.worker = 'generating';
    broadcast(true);
    // The op chain is named here for the same reason the edit path names it:
    // ops are silent when they have nothing to do — a Decimate under its face
    // cap, a Fill Holes on a closed surface — so a mesh that comes back
    // unchanged is indistinguishable from a chain that never ran unless the
    // log says what was asked for.
    const chain = spec.postProcess.length ? `, then ${spec.postProcess.map(describeMeshOp).join(', ')}` : '';
    glog.info(
      `generating ${spec.export.baseName}.${spec.export.format} with ${spec.modelId}${chain}`,
      job.id
    );

    instance.send({ cmd: 'generate', job: spec });
    const result = await awaitGenerate(instance, job);
    if (result.event === 'done') markDone(job, result);
    else if (result.event === 'cancelled') markCancelled(job);
    else markFailed(job, formatWorkerError(result));
    if (state.worker === 'generating') state.worker = 'idle';
  } catch (err) {
    if (!isFinished(job)) {
      if (isCancelled(err) || cancelRequests.has(job.id)) markCancelled(job);
      else markFailed(job, errorMessage(err));
    }
    if (state.worker === 'generating' || state.worker === 'loading') state.worker = worker?.alive ? 'idle' : 'stopped';
  } finally {
    cancelRequests.delete(job.id);
    if (hardCancelTimer) {
      clearTimeout(hardCancelTimer);
      hardCancelTimer = null;
    }
    state.activeJobId = null;
    trimJobs();
    broadcast(true);
  }
}

function pump(): void {
  if (pumping) return;
  pumping = true;
  void (async () => {
    try {
      for (;;) {
        const next = state.jobs.find((j) => j.status === 'queued');
        if (!next) break;
        try {
          await runJob(next);
        } catch (err) {
          // runJob handles its own failures; anything that still escapes would
          // otherwise leave the job non-terminal for good — and, because the
          // loop is the only thing that clears activeJobId, the whole queue
          // permanently "busy". Close the job out and carry on.
          if (!isFinished(next)) markFailed(next, errorMessage(err));
          if (state.activeJobId === next.id) state.activeJobId = null;
        }
      }
    } finally {
      pumping = false;
      scheduleIdleUnload();
      broadcast(true);
    }
  })();
}

/**
 * Start: promote every draft that can actually run, then work down the list.
 * A draft that is blocked — no image, no model, a model that is not installed —
 * is left exactly where it is. Failing it would throw away a half-built row the
 * user is still assembling; the row shows its own blocker instead.
 */
export function startQueue(): number {
  const installed = installedModelIds();
  const pipelines = new Set(listPipelines().map((p) => p.id));
  let promoted = 0;
  for (const job of state.jobs) {
    if (job.status !== 'draft') continue;
    if (jobBlocker(job.draft, installed, pipelines)) continue;
    job.status = 'queued';
    job.progress = { pct: 0, stage: 'queued', message: 'Queued' };
    job.error = undefined;
    promoted += 1;
    glog.info(`queued ${jobTitle(job.draft)}`, job.id);
  }
  if (promoted) {
    glog.info(`start: ${plural(promoted, 'job')} queued`);
    broadcast(true);
  }
  pump();
  return promoted;
}

export function cancelGeneration(jobId: string): void {
  const job = findJob(jobId);
  // A draft has nothing to cancel — removeJob is what gets rid of one.
  if (!job || job.status === 'draft' || isFinished(job)) return;
  if (job.status === 'queued') {
    markCancelled(job);
    broadcast(true);
    return;
  }
  cancelRequests.add(jobId);
  glog.info(`cancelling while ${job.status}`, jobId);
  try {
    worker?.send({ cmd: 'cancel', job_id: jobId });
  } catch (err) {
    glog.warn(`could not deliver the cancel to the worker: ${errorMessage(err)}`, jobId);
  }
  if (hardCancelTimer) clearTimeout(hardCancelTimer);
  hardCancelTimer = setTimeout(() => {
    hardCancelTimer = null;
    // Keyed on the cancel request, not the job row: removeJob cancels and then
    // takes the row out of the list, and the worker still has to be stopped.
    // runJob's finally clears the request once the job is really over.
    if (!cancelRequests.has(jobId)) return;
    glog.warn(
      `worker did not stop within ${HARD_CANCEL_MS / 1000}s of the cancel; killing it ` +
        '(a backend stuck inside a library call cannot be interrupted any other way)',
      jobId
    );
    void stopWorker(false);
  }, HARD_CANCEL_MS);
}

/** Everything a job owns on disk. Guarded, because these paths came out of a file. */
function removeJobFiles(job: GenerationJob): void {
  const paths = getPaths();
  for (const [root, dir] of [
    [paths.cache, job.cacheDir],
    [paths.inputs, path.join(paths.inputs, job.id)],
  ] as const) {
    if (!isInside(root, dir)) continue;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      glog.warn(`could not delete ${path.basename(dir)}: ${errorMessage(err)}`, job.id);
    }
  }
}

/** Delete a job and everything it owns. Cancels it first if it is still live. */
export function removeJob(jobId: string): boolean {
  const job = findJob(jobId);
  if (!job) return false;
  if (!isFinished(job) && job.status !== 'draft') cancelGeneration(jobId);
  const kept = job.revisions.length;
  dropJob(job);
  removeJobFiles(job);
  glog.info(
    `job deleted: ${jobTitle(job.draft)}${kept ? ` (${plural(kept, 'unsaved revision')} discarded)` : ''}`,
    job.id
  );
  broadcast(true);
  return true;
}

/** The row's back and forward: point the viewer at another revision. */
export function setJobCursor(jobId: string, cursor: number): boolean {
  const job = findJob(jobId);
  if (!job || job.revisions.length === 0) return false;
  const next = Math.max(0, Math.min(job.revisions.length - 1, Math.round(Number(cursor) || 0)));
  if (next === job.cursor) return true;
  job.cursor = next;
  broadcast(true);
  return true;
}

// ---------------------------------------------------------------------------
// Editing a finished job
// ---------------------------------------------------------------------------

const PROCESS_TIMEOUT_MS = 10 * 60_000;

/**
 * Run one mesh edit on a job's current revision and push the result on as a new
 * revision. The worker is single-threaded, so this refuses rather than queues
 * when anything else is using it; no model is needed and a loaded one stays
 * loaded.
 *
 * Undo semantics: an edit made while the user is looking at an earlier revision
 * branches from there. The revisions after the cursor are dropped, files and
 * all — keeping them would mean a history with two futures, and nothing in the
 * UI could show that.
 */
export async function applyJobEdit(jobId: string, op: MeshOp): Promise<boolean> {
  const normalized = normalizeMeshOp(op);
  const job = findJob(jobId);
  if (!job) return false;
  const source = currentRevision(job);
  if (!source) throw new Error('This job has no mesh to edit yet.');
  if (!fs.existsSync(source.path)) throw new Error('That revision is no longer in the cache folder.');
  if (state.processing) throw new Error('Another mesh is already being processed. Wait for it to finish.');
  if (isBusy()) throw new Error('The generation queue is busy. Wait for the current job to finish.');

  if (job.cursor < job.revisions.length - 1) {
    for (const dropped of job.revisions.slice(job.cursor + 1)) {
      if (isInside(job.cacheDir, dropped.path)) fs.rmSync(dropped.path, { force: true });
    }
    job.revisions = job.revisions.slice(0, job.cursor + 1);
  }

  const ext = path.extname(source.path).slice(1).toLowerCase() || job.draft.format;
  const suffix = MESH_OP_DEFINITIONS[normalized.op].suffix;
  const output = path.join(job.cacheDir, `${jobStem(job.draft)}-${job.revisions.length}-${suffix}.${ext}`);
  const requestId = newId('proc');

  state.processing = { requestId, jobId: job.id, stage: 'load', pct: 0, message: 'Starting', startedAt: Date.now() };
  job.editing = { op: normalized.op, pct: 0, message: 'Starting' };
  clearIdleTimer();
  state.idleUnloadAt = null;
  broadcast(true);

  try {
    const instance = await ensureWorker();
    state.worker = 'processing';
    broadcast(true);
    glog.info(`editing ${jobTitle(job.draft)}: ${describeMeshOp(normalized)}`, requestId);

    instance.send({ cmd: 'process', request_id: requestId, input: source.path, output, ops: [normalized] });
    const event = await instance.waitFor(
      (e) =>
        (e.event === 'processed' && e.request_id === requestId) ||
        (e.event === 'cancelled' && e.job_id === requestId) ||
        (e.event === 'error' && (e.request_id === requestId || (!e.request_id && !e.job_id))),
      PROCESS_TIMEOUT_MS,
      'mesh processing'
    );
    if (event.event === 'error') throw new Error(formatWorkerError(event));
    if (event.event !== 'processed') throw new Error('The edit was cancelled.');

    // The row may have been deleted while the worker was busy; the file it just
    // wrote went with its cache directory, so there is nothing to record.
    if (!findJob(jobId)) return false;
    job.revisions.push({
      path: event.output,
      op: normalized,
      vertices: event.vertices,
      faces: event.faces,
      createdAt: Date.now(),
    });
    job.cursor = job.revisions.length - 1;
    glog.info(
      `edit applied in ${formatDuration(event.duration_ms)} → revision ${job.cursor + 1} ` +
        `(${event.vertices} verts, ${event.faces} faces)`,
      requestId
    );
    return true;
  } catch (err) {
    // Logged here so the line carries the request id; `reported` keeps the IPC
    // wrapper from writing the same failure again without it.
    glog.error(`edit failed: ${errorMessage(err)}`, requestId);
    throw reported(err);
  } finally {
    state.processing = null;
    job.editing = null;
    if (state.worker === 'processing') state.worker = worker?.alive ? 'idle' : 'stopped';
    scheduleIdleUnload();
    broadcast(true);
  }
}

/**
 * Keep it: copy the current revision into outputs/ under the job's name, then
 * let the job — and its whole cache directory — go. This is the only thing in
 * the app that writes to outputs/, which is what makes that folder mean "meshes
 * I chose to keep" rather than "everything I ever ran".
 */
export function saveJob(jobId: string): string | null {
  const job = findJob(jobId);
  if (!job) return null;
  const revision = currentRevision(job);
  if (!revision) throw new Error('This job has nothing to save yet.');
  if (!fs.existsSync(revision.path)) throw new Error('That revision is no longer in the cache folder.');

  // The extension of the file that actually exists, not the draft's current
  // format: changing the format after a job has run does not re-export it, and
  // a .glb saved as `name.obj` would be a lie.
  const ext = path.extname(revision.path).slice(1).toLowerCase() || job.draft.format;
  const target = uniquePath(getPaths().outputs, jobStem(job.draft), ext);
  fs.copyFileSync(revision.path, target);
  job.savedPath = target;

  const extra = job.revisions.length > 1 ? ` (revision ${job.cursor + 1} of ${job.revisions.length})` : '';
  glog.info(`saved → outputs/${path.basename(target)}${extra}`, job.id);

  dropJob(job);
  removeJobFiles(job);
  broadcast(true);
  return target;
}

// ---------------------------------------------------------------------------
// Worker controls
// ---------------------------------------------------------------------------

export async function loadModel(modelId: string): Promise<void> {
  if (isBusy()) throw new Error('The queue is busy; wait for the current job to finish.');
  const instance = await ensureWorker();
  await loadInternal(instance, modelId);
  scheduleIdleUnload();
}

export async function unloadModel(): Promise<void> {
  if (isBusy()) throw new Error('The queue is busy; wait for the current job to finish.');
  if (!worker?.alive) {
    state.loadedModelId = null;
    broadcast(true);
    return;
  }
  await unloadInternal(worker);
  scheduleIdleUnload();
}

export async function stopWorker(graceful = true): Promise<void> {
  clearIdleTimer();
  state.idleUnloadAt = null;
  const instance = worker;
  if (!instance?.alive) {
    worker = null;
    state.worker = 'stopped';
    state.loadedModelId = null;
    state.loadingModelId = null;
    broadcast(true);
    return;
  }
  stopping = true;
  // Published so ensureWorker() waits for the process to actually be gone
  // instead of handing the next job a worker that is mid-shutdown. A second
  // stop (the hard cancel, say) still reaches instance.stop and kills it.
  const done = instance.stop(graceful).then(
    () => undefined,
    () => undefined
  );
  stopPromise = done;
  try {
    await done;
  } finally {
    if (stopPromise === done) {
      stopPromise = null;
      stopping = false;
    }
  }
}

/** Settings changed: re-arm the idle timer against the new values. */
export function onSettingsChanged(): void {
  scheduleIdleUnload();
}

/** App quit: stop the worker, get the job list on disk, silence the broadcast timer. */
export async function shutdownQueue(): Promise<void> {
  try {
    await stopWorker(true);
  } catch (err) {
    glog.warn(`worker shutdown failed: ${errorMessage(err)}`);
  } finally {
    clearIdleTimer();
    if (hardCancelTimer) clearTimeout(hardCancelTimer);
    hardCancelTimer = null;
    stopBroadcasts();
    // Last thing, and synchronous: the debounce timer will not get another
    // turn, and what is in memory now (the jobs the worker just failed or
    // cancelled on its way out) is what the next launch has to see.
    flushJobs();
  }
}
