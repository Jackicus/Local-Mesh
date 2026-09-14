import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { compilePipeline, getModel, newId, summarizePipeline, validatePipeline } from '../core/types';
import type {
  GenerationJob,
  GenerationJobRequest,
  MeshGeneratorData,
  MeshProcessOp,
  MeshProcessRequest,
  MeshProcessResult,
  WorkerEvent,
} from '../core/types';
import { envPython, isEnvUsable } from './envManager';
import { log } from './logger';
import { getModelInstallState, modelDir } from './modelManager';
import { getPaths, isInside } from './paths';
import { readPipeline } from './pipelines';
import { CancelledError, errorMessage, isCancelled } from './proc';
import { getSettings } from './settings';
import {
  broadcast,
  findJob,
  isBusy,
  isFinished,
  state,
  stopBroadcasts,
  trimJobs,
} from './queueState';
import { WorkerProcess } from './worker';

export { getState, isBusy, isModelLoaded } from './queueState';

/**
 * The generation queue: one job at a time through one python worker, which
 * keeps a model resident between jobs. Every transition writes the shared
 * GenerationState and broadcasts a snapshot.
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
let pumping = false;
let stopping = false;
let idleTimer: NodeJS.Timeout | null = null;
let hardCancelTimer: NodeJS.Timeout | null = null;
const cancelRequests = new Set<string>();

type TerminalEvent = Extract<WorkerEvent, { event: 'done' | 'cancelled' | 'error' }>;

// ---------------------------------------------------------------------------
// Worker lifecycle
// ---------------------------------------------------------------------------

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
    } else {
      markFailed(job, `The python worker exited unexpectedly (${detail}).`);
      state.worker = 'error';
      state.workerError = `Worker exited (${detail}).`;
    }
  } else if (stopping || code === 0) {
    state.worker = 'stopped';
    state.workerError = null;
  } else {
    state.worker = 'error';
    state.workerError = `Worker exited (${detail}).`;
  }
  glog.info(`worker exited (${detail})`);
  broadcast(true);
}

async function ensureWorker(): Promise<WorkerProcess> {
  if (worker?.alive) return worker;
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

  try {
    const ready = await instance.waitFor((e) => e.event === 'ready', WORKER_START_MS, 'worker startup');
    if (ready.event === 'ready') {
      state.memory = { ...state.memory, vramTotalBytes: ready.vram_total, sampledAt: Date.now() };
      glog.info(
        `worker ready: python ${ready.python}, torch ${ready.torch ?? 'missing'}, cuda ${ready.cuda}${ready.gpu ? ` (${ready.gpu})` : ''}`
      );
    }
  } catch (err) {
    const message = errorMessage(err);
    state.worker = 'error';
    state.workerError = message;
    broadcast(true);
    await instance.stop(false);
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
  state.worker = 'unloading';
  broadcast(true);
  try {
    instance.send({ cmd: 'unload' });
    const event = await instance.waitFor(
      (e) => e.event === 'unloaded' || e.event === 'error',
      UNLOAD_TIMEOUT_MS,
      'unload'
    );
    if (event.event === 'error') glog.warn(`unload reported an error: ${event.message}`);
  } catch (err) {
    glog.warn(`unload failed: ${errorMessage(err)}`);
  }
  state.loadedModelId = null;
  if (state.worker === 'unloading') state.worker = 'idle';
  glog.info(`unloaded ${previous}`);
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
  glog.info(`loading ${modelId} (device ${settings.device}, precision ${settings.precision}, low_vram ${settings.lowVram})`);

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
    if (event.event === 'loaded') glog.info(`loaded ${modelId} in ${Math.round(event.duration_ms)}ms`);
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

function markDone(job: GenerationJob, event: Extract<WorkerEvent, { event: 'done' }>): void {
  job.status = 'done';
  job.finishedAt = Date.now();
  job.outputPath = event.output;
  job.stats = { vertices: event.vertices, faces: event.faces };
  job.progress = { pct: 100, stage: 'export', message: 'Done' };
  glog.info(
    `done in ${Math.round(event.duration_ms)}ms → ${path.basename(event.output)} (${event.vertices} verts, ${event.faces} faces)`,
    job.id
  );
}

function markFailed(job: GenerationJob, message: string): void {
  job.status = 'failed';
  job.finishedAt = Date.now();
  job.error = message;
  glog.error(message, job.id);
}

function markCancelled(job: GenerationJob): void {
  job.status = 'cancelled';
  job.finishedAt = Date.now();
  glog.warn('job cancelled', job.id);
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
  try {
    if (getSettings().stopWorkerWhenIdle) {
      glog.info('idle timeout: stopping the worker');
      await stopWorker();
    } else if (worker?.alive && state.loadedModelId) {
      glog.info('idle timeout: unloading the model');
      await unloadInternal(worker);
    }
  } catch (err) {
    glog.warn(`idle unload failed: ${errorMessage(err)}`);
  }
  broadcast(true);
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

async function runJob(job: GenerationJob): Promise<void> {
  state.activeJobId = job.id;
  job.startedAt = Date.now();
  job.status = 'loading';
  job.progress = { pct: 0, stage: 'load', message: 'Preparing worker' };
  clearIdleTimer();
  state.idleUnloadAt = null;
  broadcast(true);

  try {
    const instance = await ensureWorker();
    if (cancelRequests.has(job.id)) throw new CancelledError();
    if (state.loadedModelId !== job.modelId) await loadInternal(instance, job.modelId);
    if (cancelRequests.has(job.id)) throw new CancelledError();

    job.status = 'running';
    job.runningAt = Date.now();
    job.progress = { pct: 0, stage: 'prepare', message: 'Starting' };
    state.worker = 'generating';
    broadcast(true);
    glog.info(`generating ${job.spec.export.baseName}.${job.spec.export.format} with ${job.modelId}`, job.id);

    instance.send({ cmd: 'generate', job: job.spec });
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
        await runJob(next);
      }
    } finally {
      pumping = false;
      scheduleIdleUnload();
      broadcast(true);
    }
  })();
}

function resolveSeed(configured: unknown): number {
  const n = typeof configured === 'number' ? configured : Number(configured);
  if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  return crypto.randomInt(0, 0xffffffff);
}

export function enqueue(request: GenerationJobRequest): string[] {
  if (!request || typeof request.pipelineId !== 'string') throw new Error('No pipeline selected.');
  const pipeline = readPipeline(request.pipelineId);
  if (!pipeline) throw new Error(`Pipeline "${request.pipelineId}" could not be read.`);
  let images = Array.isArray(request.imagePaths) ? request.imagePaths.filter((p) => typeof p === 'string') : [];
  if (images.length === 0) {
    // No images staged: fall back to the Image Input node's fixed image, if any.
    const fixed = summarizePipeline(pipeline).fixedImagePath;
    if (fixed) images = [fixed];
  }
  if (images.length === 0) throw new Error('Choose at least one image.');
  // Check every source before queueing anything, so a bad path can't leave half a batch running.
  const missing = images.filter((p) => !fs.existsSync(p));
  if (missing.length) throw new Error(`Image not found: ${missing.join(', ')}`);
  const errors = validatePipeline(pipeline).filter((i) => i.level === 'error');
  if (errors.length) throw new Error(errors.map((e) => e.message).join(' '));

  const paths = getPaths();
  const genNode = pipeline.nodes.find((n) => n.type === 'mesh-generator');
  const configuredSeed = (genNode?.data as MeshGeneratorData | undefined)?.settings?.['seed'];
  const now = new Date();
  const ids: string[] = [];

  images.forEach((source, index) => {
    const jobId = newId('job');
    const name = path.basename(source);
    const inputDir = path.join(paths.inputs, jobId);
    fs.mkdirSync(inputDir, { recursive: true });
    const imagePath = path.join(inputDir, name);
    fs.copyFileSync(source, imagePath);

    const spec = compilePipeline(pipeline, {
      jobId,
      imagePath,
      imageStem: path.basename(name, path.extname(name)),
      outputDir: paths.outputs,
      pipelineName: pipeline.name,
      seed: resolveSeed(configuredSeed),
      index,
      now,
    });
    const job: GenerationJob = {
      id: jobId,
      pipelineId: pipeline.id,
      pipelineName: pipeline.name,
      modelId: spec.modelId,
      imagePath,
      imageName: name,
      spec,
      status: 'queued',
      progress: { pct: 0, stage: 'queued', message: 'Queued' },
      createdAt: Date.now(),
    };
    state.jobs.push(job);
    ids.push(jobId);
    glog.info(`queued ${name} → ${spec.modelId} (seed ${String(spec.settings['seed'])})`, jobId);
  });

  trimJobs();
  broadcast(true);
  pump();
  return ids;
}

export function cancelGeneration(jobId: string): void {
  const job = findJob(jobId);
  if (!job || isFinished(job)) return;
  if (job.status === 'queued') {
    markCancelled(job);
    trimJobs();
    broadcast(true);
    return;
  }
  cancelRequests.add(jobId);
  glog.info('cancel requested', jobId);
  try {
    worker?.send({ cmd: 'cancel', job_id: jobId });
  } catch (err) {
    glog.warn(`could not deliver cancel: ${errorMessage(err)}`, jobId);
  }
  if (hardCancelTimer) clearTimeout(hardCancelTimer);
  hardCancelTimer = setTimeout(() => {
    hardCancelTimer = null;
    const current = findJob(jobId);
    if (!current || isFinished(current)) return;
    glog.warn('worker did not acknowledge the cancel; killing it', jobId);
    void stopWorker(false);
  }, HARD_CANCEL_MS);
}

export function clearFinishedJobs(): void {
  state.jobs = state.jobs.filter((j) => !isFinished(j));
  broadcast(true);
}

// ---------------------------------------------------------------------------
// Mesh post-processing (Reduce / Smooth on a finished output)
// ---------------------------------------------------------------------------

const PROCESS_TIMEOUT_MS = 10 * 60_000;
const MAX_SMOOTH_ITERATIONS = 200;
/** Suffixes this feature appends, stripped before appending again. */
const PROCESS_SUFFIX = /-(?:reduced|smooth)$/;

function validateOps(raw: unknown): MeshProcessOp[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('Choose at least one mesh operation.');
  return raw.map((item): MeshProcessOp => {
    const op = (item as { op?: unknown } | null)?.op;
    if (op === 'decimate') {
      const ratio = Number((item as { ratio?: unknown }).ratio);
      if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) {
        throw new Error('Reduce needs a ratio strictly between 0 and 1.');
      }
      return { op: 'decimate', ratio };
    }
    if (op === 'smooth') {
      const iterations = Math.round(Number((item as { iterations?: unknown }).iterations));
      if (!Number.isFinite(iterations) || iterations < 1 || iterations > MAX_SMOOTH_ITERATIONS) {
        throw new Error(`Smooth needs an iteration count between 1 and ${MAX_SMOOTH_ITERATIONS}.`);
      }
      return { op: 'smooth', iterations };
    }
    throw new Error(`Unknown mesh operation "${String(op)}".`);
  });
}

/** `cat-reduced-smooth` → `cat`, so repeated passes don't grow the name forever. */
function baseStem(stem: string): string {
  let out = stem;
  for (;;) {
    const next = out.replace(PROCESS_SUFFIX, '');
    if (next === out || next === '') return out;
    out = next;
  }
}

function suffixFor(ops: MeshProcessOp[]): string {
  const parts: string[] = [];
  if (ops.some((o) => o.op === 'decimate')) parts.push('reduced');
  if (ops.some((o) => o.op === 'smooth')) parts.push('smooth');
  return parts.join('-') || 'processed';
}

function describeOp(op: MeshProcessOp): string {
  return op.op === 'decimate' ? `decimate to ${Math.round(op.ratio * 100)}%` : `smooth x${op.iterations}`;
}

/**
 * Run trimesh ops on an existing output and write a sibling file. The worker is
 * single-threaded, so this refuses rather than queues when anything else is
 * using it; no model is needed and a loaded one stays loaded.
 */
export async function processMesh(request: MeshProcessRequest): Promise<MeshProcessResult> {
  const ops = validateOps(request?.ops);
  const paths = getPaths();
  const inputPath = typeof request?.inputPath === 'string' ? path.resolve(request.inputPath) : '';
  if (!inputPath || !isInside(paths.outputs, inputPath)) {
    throw new Error('Only files inside the outputs folder can be processed.');
  }
  if (!fs.existsSync(inputPath)) throw new Error(`File not found: ${path.basename(inputPath)}`);
  if (state.processing) throw new Error('Another mesh is already being processed. Wait for it to finish.');
  if (isBusy()) throw new Error('The generation queue is busy. Wait for the current job to finish.');

  const ext = path.extname(inputPath) || '.glb';
  const output = path.join(paths.outputs, `${baseStem(path.basename(inputPath, ext))}-${suffixFor(ops)}${ext}`);
  const requestId = newId('proc');

  state.processing = { requestId, stage: 'load', pct: 0, message: 'Starting', startedAt: Date.now() };
  clearIdleTimer();
  state.idleUnloadAt = null;
  broadcast(true);

  try {
    const instance = await ensureWorker();
    state.worker = 'processing';
    broadcast(true);
    glog.info(
      `processing ${path.basename(inputPath)} → ${path.basename(output)} (${ops.map(describeOp).join(', ')})`,
      requestId
    );

    instance.send({ cmd: 'process', request_id: requestId, input: inputPath, output, ops });
    const event = await instance.waitFor(
      (e) =>
        (e.event === 'processed' && e.request_id === requestId) ||
        (e.event === 'cancelled' && e.job_id === requestId) ||
        (e.event === 'error' && (e.request_id === requestId || (!e.request_id && !e.job_id))),
      PROCESS_TIMEOUT_MS,
      'mesh processing'
    );
    if (event.event === 'error') throw new Error(formatWorkerError(event));
    if (event.event !== 'processed') throw new Error('Mesh processing was cancelled.');

    glog.info(
      `processed in ${Math.round(event.duration_ms)}ms → ${path.basename(event.output)} (${event.vertices} verts, ${event.faces} faces)`,
      requestId
    );
    return {
      outputPath: event.output,
      vertices: event.vertices,
      faces: event.faces,
      durationMs: event.duration_ms,
    };
  } catch (err) {
    glog.error(`mesh processing failed: ${errorMessage(err)}`, requestId);
    throw err;
  } finally {
    state.processing = null;
    if (state.worker === 'processing') state.worker = worker?.alive ? 'idle' : 'stopped';
    scheduleIdleUnload();
    broadcast(true);
  }
}

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
  try {
    await instance.stop(graceful);
  } finally {
    stopping = false;
  }
}

/** Settings changed: re-arm the idle timer against the new values. */
export function onSettingsChanged(): void {
  scheduleIdleUnload();
}

/** App quit: stop the worker and silence the broadcast timer. */
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
  }
}
