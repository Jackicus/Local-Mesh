import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import { DEFAULT_SETTINGS, IPC_CHANNELS, isPending, isTerminalStatus, normalizeDraft, normalizeMeshOp } from '../core/types';
import type { GenerationJob, GenerationState, JobRevision, JobStatus } from '../core/types';
import { log } from './logger';
import { getPaths, getQueuePath, isInside } from './paths';
import { writeJsonAtomic } from './settings';

/**
 * The job list: the single mutable GenerationState snapshot, its throttled
 * broadcast, and the file it is written to.
 *
 * Kept apart from queue.ts so modules that only need to *read* the queue
 * (outputs.ts, modelManager.ts) don't have to import the whole state machine —
 * that import would be circular, since the queue asks modelManager where a
 * model lives. Nothing here spawns a worker or touches a model; it is state,
 * a socket to push it down, and a file to keep it in.
 *
 * The file is the new part. A finished job used to be a receipt — the mesh was
 * already in outputs/ and the row was only a record that it had happened, so
 * throwing the row away cost nothing. Now a finished job *holds* the work: its
 * mesh and every edited revision live in cache/<jobId>/ and reach outputs/
 * only when the user saves. Losing the row on quit would lose all of it, so
 * the list is durable and only Save or Delete takes a job out of it.
 */

/**
 * Why there is no aggressive trim any more: the old cap threw away the oldest
 * finished jobs to keep the snapshot small, which now means deleting meshes the
 * user has not decided about yet. So the cap is high enough that nobody
 * reaches it by working, and only jobs with nothing to lose — no revisions, so
 * a failure or a cancel — are dropped when it is. A job holding revisions is
 * never trimmed; if the list really is enormous, that is the user's to clear.
 */
export const MAX_FINISHED_JOBS = 500;

/** Snapshots are coalesced to ~10/s so per-step progress can't flood IPC. */
const BROADCAST_INTERVAL_MS = 100;

/** Long enough that a burst of edits is one write, short enough to survive a kill. */
const PERSIST_DEBOUNCE_MS = 400;

const QUEUE_FILE_VERSION = 1;

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

export function isFinished(job: GenerationJob): boolean {
  return isTerminalStatus(job.status);
}

/** The model this job runs, from its compiled spec or, before it runs, its draft. */
export function jobModelId(job: GenerationJob): string | null {
  if (job.spec) return job.spec.modelId;
  return job.draft.source.kind === 'model' ? job.draft.source.modelId || null : null;
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
 * Move a job to another slot among the jobs that have not started. Drafts and
 * queued jobs move together: they are one band in the UI, Start promotes the
 * whole band in list order, and pump() then takes the first `queued` entry in
 * array order — so a job that has already started keeps the position it holds.
 * Returns false when the move is impossible or a no-op.
 */
export function reorderQueue(jobId: string, toIndex: number): boolean {
  const job = findJob(jobId);
  if (!job || !isPending(job.status)) return false;
  const pending = state.jobs.filter((j) => isPending(j.status));
  const from = pending.indexOf(job);
  const to = Math.max(0, Math.min(pending.length - 1, Math.round(toIndex)));
  if (from < 0 || from === to) return false;
  pending.splice(from, 1);
  pending.splice(to, 0, job);
  let next = 0;
  state.jobs = state.jobs.map((j) => (isPending(j.status) ? pending[next++]! : j));
  broadcast(true);
  return true;
}

/** Take a job out of the list. Its directories are the caller's to remove. */
export function dropJob(job: GenerationJob): void {
  state.jobs = state.jobs.filter((j) => j !== job);
}

/** Drop the oldest finished jobs that hold no work, once there are absurdly many. */
export function trimJobs(): void {
  const finished = state.jobs.filter(isFinished);
  if (finished.length <= MAX_FINISHED_JOBS) return;
  const droppable = finished.filter((j) => j.revisions.length === 0);
  const drop = new Set(droppable.slice(0, finished.length - MAX_FINISHED_JOBS));
  if (drop.size === 0) return;
  state.jobs = state.jobs.filter((j) => !drop.has(j));
}

// ---------------------------------------------------------------------------
// Broadcast
// ---------------------------------------------------------------------------

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
  // Every mutation broadcasts, so this is also the one place that has to
  // notice the list changed — no caller can forget to save.
  schedulePersist();
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

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * What actually goes in the file. Progress, the compiled spec and an in-flight
 * edit are all about a run that cannot outlive the process, and leaving them
 * out is not only tidiness: they are the fields that change on every progress
 * tick, and without them the serialised form is stable through a whole
 * generation, so the identity check below turns ~10 writes a second into three.
 */
interface StoredJob {
  id: string;
  draft: GenerationJob['draft'];
  imagePath: string | null;
  imageName: string | null;
  status: JobStatus;
  createdAt: number;
  startedAt?: number;
  runningAt?: number;
  finishedAt?: number;
  revisions: JobRevision[];
  cursor: number;
  error?: string;
}

function toStored(job: GenerationJob): StoredJob {
  return {
    id: job.id,
    draft: job.draft,
    imagePath: job.imagePath,
    imageName: job.imageName,
    status: job.status,
    createdAt: job.createdAt,
    ...(job.startedAt ? { startedAt: job.startedAt } : {}),
    ...(job.runningAt ? { runningAt: job.runningAt } : {}),
    ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
    revisions: job.revisions,
    cursor: job.cursor,
    ...(job.error ? { error: job.error } : {}),
  };
}

let persistTimer: NodeJS.Timeout | null = null;
let lastWritten: string | null = null;
/** Nothing is written back until the file has been read, or a crash loses the list. */
let loaded = false;

function writeQueueFile(): void {
  if (!loaded) return;
  const snapshot = { version: QUEUE_FILE_VERSION, jobs: state.jobs.map(toStored) };
  const text = JSON.stringify(snapshot);
  // A generation mutates `progress` ten times a second and nothing else; the
  // stored shape leaves progress out, so this comparison makes those free.
  if (text === lastWritten) return;
  try {
    writeJsonAtomic(getQueuePath(), snapshot);
    lastWritten = text;
  } catch (err) {
    log.general.warn(`the job queue could not be saved: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function schedulePersist(): void {
  if (!loaded || persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    writeQueueFile();
  }, PERSIST_DEBOUNCE_MS);
}

/** App quit: get the list on disk now, debounce or no debounce. */
export function flushJobs(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  writeQueueFile();
}

// ---------------------------------------------------------------------------
// Loading
//
// queue.json is a plain file in the user's own directory, so it is editable,
// truncatable and copyable between machines. Nothing in here may throw on what
// it finds: a queue file that crashes the app on launch is an app that cannot
// be started at all, which is far worse than a queue that comes back empty.
// ---------------------------------------------------------------------------

function normalizeRevisions(raw: unknown, cacheDir: string): JobRevision[] {
  if (!Array.isArray(raw)) return [];
  const out: JobRevision[] = [];
  for (const entry of raw) {
    const r = (entry ?? {}) as Partial<JobRevision>;
    if (typeof r.path !== 'string' || !r.path) continue;
    // A revision that is not in this job's own cache directory is either a
    // hand-edited file or a leftover from an older layout; either way it is not
    // ours to read back or, later, to delete.
    if (!isInside(cacheDir, r.path)) continue;
    // The user empties cache/ between runs, or a revision is deleted by hand.
    // A job that has lost its files is still a row — it just has nothing to show.
    if (!fs.existsSync(r.path)) continue;
    let op: JobRevision['op'] = null;
    if (r.op) {
      try {
        op = normalizeMeshOp(r.op);
      } catch {
        // An op that no longer normalises still described a real file; keep the
        // revision and lose only the label.
        op = null;
      }
    }
    out.push({
      path: r.path,
      op,
      vertices: Number.isFinite(r.vertices) ? Number(r.vertices) : 0,
      faces: Number.isFinite(r.faces) ? Number(r.faces) : 0,
      createdAt: Number.isFinite(r.createdAt) ? Number(r.createdAt) : Date.now(),
    });
  }
  return out;
}

const STATUSES: JobStatus[] = ['draft', 'queued', 'loading', 'running', 'done', 'failed', 'cancelled'];

function restoreJob(raw: unknown, fallbackModelId: string | null): GenerationJob | null {
  const value = (raw ?? {}) as Partial<StoredJob>;
  if (typeof value.id !== 'string' || !value.id || !/^[\w-]+$/.test(value.id)) return null;
  const cacheDir = path.join(getPaths().cache, value.id);
  const draft = normalizeDraft(value.draft, fallbackModelId);
  const revisions = normalizeRevisions(value.revisions, cacheDir);

  let status: JobStatus = STATUSES.includes(value.status as JobStatus) ? (value.status as JobStatus) : 'draft';
  let error = typeof value.error === 'string' ? value.error : undefined;
  if (status === 'loading' || status === 'running') {
    // The worker died with the app; there is no run to rejoin and no way to
    // know how far it got, so the honest answer is that it did not finish.
    status = 'failed';
    error = 'Local Mesh closed while this job was running, so it never finished.';
  } else if (status === 'queued') {
    // It had been promoted but never started. Starting the queue on its own at
    // launch would be the app deciding to burn a GPU without being asked, so it
    // goes back to being a draft and waits for Start.
    status = 'draft';
  } else if (status === 'done' && revisions.length === 0) {
    status = 'failed';
    error = 'The mesh this job produced is no longer in the cache folder.';
  }

  const cursor = revisions.length ? Math.max(0, Math.min(revisions.length - 1, Math.round(Number(value.cursor) || 0))) : 0;
  const imagePath = typeof value.imagePath === 'string' && value.imagePath ? value.imagePath : null;

  return {
    id: value.id,
    draft,
    imagePath,
    imageName: typeof value.imageName === 'string' && value.imageName ? value.imageName : imagePath ? path.basename(imagePath) : null,
    cacheDir,
    status,
    progress: isTerminalStatus(status)
      ? { pct: status === 'done' ? 100 : 0, stage: status, message: status === 'done' ? 'Done' : '' }
      : { pct: 0, stage: 'draft', message: '' },
    createdAt: Number.isFinite(value.createdAt) ? Number(value.createdAt) : Date.now(),
    ...(Number.isFinite(value.startedAt) ? { startedAt: Number(value.startedAt) } : {}),
    ...(Number.isFinite(value.runningAt) ? { runningAt: Number(value.runningAt) } : {}),
    ...(Number.isFinite(value.finishedAt) ? { finishedAt: Number(value.finishedAt) } : {}),
    revisions,
    cursor,
    editing: null,
    ...(error ? { error } : {}),
  };
}

/**
 * Read the job list back. Called once, after the directory tree exists and the
 * logger is up. `fallbackModelId` fills in a draft whose model is missing from
 * the file entirely — a hand-edited entry, or one written before a model id
 * changed.
 */
export function loadJobs(fallbackModelId: string | null): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(getQueuePath(), 'utf-8'));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      log.general.warn(`queue.json unreadable, starting with an empty queue: ${err instanceof Error ? err.message : err}`);
    }
    loaded = true;
    return;
  }
  const rawJobs = (parsed as { jobs?: unknown })?.jobs;
  const jobs: GenerationJob[] = [];
  const seen = new Set<string>();
  if (Array.isArray(rawJobs)) {
    for (const raw of rawJobs) {
      let job: GenerationJob | null = null;
      try {
        job = restoreJob(raw, fallbackModelId);
      } catch (err) {
        // restoreJob coerces rather than throws, so this is a bug rather than
        // bad data — but losing one row still beats refusing to start.
        log.general.warn(`a job in queue.json could not be restored: ${err instanceof Error ? err.message : err}`);
      }
      if (!job || seen.has(job.id)) continue;
      seen.add(job.id);
      jobs.push(job);
    }
  }
  state.jobs = jobs;
  // Set before the first broadcast and whatever else happens: until this is
  // true nothing is written back, which is what stops an unread file from
  // being overwritten with an empty list.
  loaded = true;
  if (jobs.length) {
    const withWork = jobs.filter((j) => j.revisions.length > 0).length;
    log.generation.info(
      `restored ${jobs.length} job${jobs.length === 1 ? '' : 's'} from the queue file` +
        (withWork ? `, ${withWork} holding unsaved meshes` : '')
    );
  }
  // Whatever coercion just did (a demoted status, dropped revisions) is now the
  // truth; write it back so the file and the snapshot never disagree.
  broadcast(true);
}
