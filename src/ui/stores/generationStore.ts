import type { GenerationState, MeshOp } from '../../core/types';
import type { JobDraft } from '../../core/jobs';
import { api, createStore, useStore } from './createStore';
import { toast } from '../components/Toast/toastStore';

/**
 * Mirror of the main process queue/worker state. Main pushes a full snapshot
 * on every change; we replace wholesale. Actions are thin IPC wrappers.
 *
 * The queue is the Generate view's workspace, so nearly every verb in that
 * view lands here: add a job, edit it, reorder it, start the line, step
 * through a finished job's revisions, save it, throw it away. None of them
 * return the new state — main answers with a push — so none of them try to
 * reconcile anything locally.
 */
export interface GenerationStoreState extends GenerationState {
  /** Set once the first snapshot has arrived. */
  hydrated: boolean;
  /**
   * Bumped by save(). Renderer-local: a saved job leaves the queue, so the
   * outputs list has no other signal that the folder just gained a file.
   */
  savedTick: number;
}

const EMPTY: GenerationStoreState = {
  hydrated: false,
  savedTick: 0,
  worker: 'stopped',
  workerError: null,
  loadedModelId: null,
  loadingModelId: null,
  device: 'auto',
  precision: 'auto',
  memory: { vramUsedBytes: null, vramTotalBytes: null, ramUsedBytes: null, sampledAt: 0 },
  jobs: [],
  activeJobId: null,
  idleUnloadAt: null,
  processing: null,
};

const store = createStore<GenerationStoreState>(EMPTY);

let bound = false;

/** Report a rejected call once, in the caller's words rather than the IPC layer's. */
function fail(err: unknown, title: string) {
  toast.error(err instanceof Error ? err.message : String(err), { title });
}

export const generationStore = {
  ...store,

  /** Subscribe to main-process pushes and pull the initial snapshot. Idempotent. */
  bind: () => {
    const electron = api();
    if (bound || !electron) return;
    bound = true;
    // A push that lands while the initial invoke is in flight is newer than the
    // snapshot that invoke will resolve with; without this flag the stale
    // snapshot would overwrite it and the queue would show the wrong state
    // until the next change happened to arrive.
    let pushed = false;
    electron.onGenerationState((state) => {
      pushed = true;
      store.setState({ ...state, hydrated: true });
    });
    electron.getGenerationState().then((state) => {
      if (pushed) {
        store.setState({ hydrated: true });
        return;
      }
      store.setState({ ...state, hydrated: true });
    });
  },

  /** One draft per image, or a single empty one when given none. Returns the new ids. */
  addJobs: async (imagePaths: string[] = []): Promise<string[]> => {
    const electron = api();
    if (!electron) return [];
    try {
      return await electron.addJobs(imagePaths);
    } catch (err) {
      fail(err, 'Could not add a job');
      return [];
    }
  },

  /** Change a job's source, image, name, modifiers or format. Refused once it has started. */
  updateJob: async (jobId: string, patch: Partial<JobDraft>): Promise<boolean> => {
    const electron = api();
    if (!electron) return false;
    try {
      return await electron.updateJob(jobId, patch);
    } catch (err) {
      fail(err, 'Could not change that job');
      return false;
    }
  },

  /** Promote every runnable draft and work down the list. Returns how many started. */
  start: async (): Promise<number> => {
    const electron = api();
    if (!electron) {
      toast.info('Generating needs the desktop app');
      return 0;
    }
    try {
      return await electron.startQueue();
    } catch (err) {
      fail(err, 'Could not start the queue');
      return 0;
    }
  },

  cancel: (jobId: string) => api()?.cancelGeneration(jobId),

  /** Move a job to `toIndex` among the jobs that have not started. */
  reorder: (jobId: string, toIndex: number) => api()?.reorderGeneration(jobId, toIndex),

  /** Delete a job and its cached revisions, cancelling it first if it is running. */
  remove: (jobId: string) => api()?.removeJob(jobId),

  /** Point a finished job at another of its revisions — the row's back and forward. */
  setCursor: (jobId: string, cursor: number) => api()?.setJobCursor(jobId, cursor),

  /** Run one edit on a finished job's current revision, pushing on a new revision. */
  applyEdit: async (jobId: string, op: MeshOp): Promise<boolean> => {
    const electron = api();
    if (!electron) {
      toast.info('Editing meshes needs the desktop app');
      return false;
    }
    try {
      return await electron.applyJobEdit(jobId, op);
    } catch (err) {
      fail(err, 'Could not apply that edit');
      return false;
    }
  },

  /** Write the current revision into outputs/ and drop the job, cache and all. */
  save: async (jobId: string): Promise<string | null> => {
    const electron = api();
    if (!electron) return null;
    try {
      const path = await electron.saveJob(jobId);
      if (path) store.setState((prev) => ({ savedTick: prev.savedTick + 1 }));
      return path;
    } catch (err) {
      fail(err, 'Could not save that mesh');
      return null;
    }
  },

  loadModel: (modelId: string) => api()?.loadModel(modelId),
  unloadModel: () => api()?.unloadModel(),
  stopWorker: () => api()?.stopWorker(),
};

export function useGenerationStore(): [GenerationStoreState, typeof generationStore] {
  return [useStore(store), generationStore];
}
