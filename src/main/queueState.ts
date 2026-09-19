import { BrowserWindow } from 'electron';
import { DEFAULT_SETTINGS, IPC_CHANNELS } from '../core/types';
import type { GenerationJob, GenerationState } from '../core/types';

/**
 * The single mutable GenerationState snapshot plus its broadcast. Kept apart
 * from queue.ts so modules that only need to *read* the queue (outputs.ts,
 * modelManager.ts) don't have to import the whole state machine — that import
 * would be circular, since the queue asks modelManager where a model lives.
 */

/** Finished jobs kept in the snapshot; older ones drop off the front. */
export const MAX_FINISHED_JOBS = 50;

/** Snapshots are coalesced to ~10/s so per-step progress can't flood IPC. */
const BROADCAST_INTERVAL_MS = 100;

export const state: GenerationState = {
  worker: 'stopped',
  workerError: null,
  loadedModelId: null,
  loadingModelId: null,
  device: DEFAULT_SETTINGS.device,
  precision: DEFAULT_SETTINGS.precision,
  memory: { vramUsedBytes: null, vramTotalBytes: null, ramUsedBytes: null, sampledAt: 0 },
  jobs: [],
  activeJobId: null,
  idleUnloadAt: null,
  processing: null,
};

export function getState(): GenerationState {
  return state;
}

export function findJob(jobId: string): GenerationJob | undefined {
  return state.jobs.find((j) => j.id === jobId);
}

export const TERMINAL_STATUSES = ['done', 'failed', 'cancelled'] as const;

export function isFinished(job: GenerationJob): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(job.status);
}

/** True while the worker (or the queue) is doing something that must not be interrupted. */
export function isBusy(): boolean {
  if (state.activeJobId !== null || state.processing !== null) return true;
  if (state.worker === 'loading' || state.worker === 'generating' || state.worker === 'unloading') return true;
  if (state.worker === 'processing') return true;
  return state.jobs.some((j) => j.status === 'queued');
}

/** True when `modelId` is resident in the worker, or on its way in. */
export function isModelLoaded(modelId: string): boolean {
  return state.loadedModelId === modelId || state.loadingModelId === modelId;
}

/**
 * Move a queued job to another slot in the queue. Only queued jobs move, and
 * only past other queued jobs: pump() takes the first `queued` entry in array
 * order, so running and finished jobs keep the positions they already hold.
 * Returns false when the move is impossible or a no-op.
 */
export function reorderQueue(jobId: string, toIndex: number): boolean {
  const job = findJob(jobId);
  if (!job || job.status !== 'queued') return false;
  const queued = state.jobs.filter((j) => j.status === 'queued');
  const from = queued.indexOf(job);
  const to = Math.max(0, Math.min(queued.length - 1, Math.round(toIndex)));
  if (from < 0 || from === to) return false;
  queued.splice(from, 1);
  queued.splice(to, 0, job);
  let next = 0;
  state.jobs = state.jobs.map((j) => (j.status === 'queued' ? queued[next++]! : j));
  broadcast(true);
  return true;
}

/**
 * Drop one finished job from the snapshot. Refuses while the job is still
 * queued or running — cancel it first, which is what the queue's stop control
 * does before it offers to dismiss.
 */
export function dismissJob(jobId: string): boolean {
  const job = findJob(jobId);
  if (!job || !isFinished(job)) return false;
  state.jobs = state.jobs.filter((j) => j !== job);
  broadcast(true);
  return true;
}

/** Drop the oldest finished jobs so the snapshot stays small. */
export function trimJobs(): void {
  const finished = state.jobs.filter(isFinished);
  if (finished.length <= MAX_FINISHED_JOBS) return;
  const drop = new Set(finished.slice(0, finished.length - MAX_FINISHED_JOBS));
  state.jobs = state.jobs.filter((j) => !drop.has(j));
}

let lastSentAt = 0;
let timer: NodeJS.Timeout | null = null;

function send(): void {
  lastSentAt = Date.now();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.GEN_STATE_CHANGED, state);
  }
}

/** Push the snapshot to every window, leading-edge then trailing-edge throttled. */
export function broadcast(immediate = false): void {
  if (immediate) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    send();
    return;
  }
  if (timer) return;
  const wait = BROADCAST_INTERVAL_MS - (Date.now() - lastSentAt);
  if (wait <= 0) {
    send();
    return;
  }
  timer = setTimeout(() => {
    timer = null;
    send();
  }, wait);
}

export function stopBroadcasts(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
