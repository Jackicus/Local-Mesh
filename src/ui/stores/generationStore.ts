import type {
  GenerationJobRequest,
  GenerationState,
  MeshProcessRequest,
  MeshProcessResult,
} from '../../core/types';
import { api, createStore, useStore } from './createStore';
import { toast } from '../components/Toast/toastStore';

/**
 * Mirror of the main process queue/worker state. Main pushes a full snapshot
 * on every change; we replace wholesale. Actions are thin IPC wrappers.
 */
export interface GenerationStoreState extends GenerationState {
  /** Set once the first snapshot has arrived. */
  hydrated: boolean;
}

const EMPTY: GenerationStoreState = {
  hydrated: false,
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

export const generationStore = {
  ...store,

  /** Subscribe to main-process pushes and pull the initial snapshot. Idempotent. */
  bind: () => {
    const electron = api();
    if (bound || !electron) return;
    bound = true;
    electron.onGenerationState((state) => store.setState({ ...state, hydrated: true }));
    electron.getGenerationState().then((state) => store.setState({ ...state, hydrated: true }));
  },

  enqueue: async (request: GenerationJobRequest): Promise<string[]> => {
    const electron = api();
    if (!electron) return [];
    try {
      const ids = await electron.enqueueGeneration(request);
      if (ids.length > 1) toast.success(`Queued ${ids.length} jobs`);
      return ids;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), { title: 'Could not queue job' });
      return [];
    }
  },

  /**
   * Reduce / smooth an existing output. The worker is single-threaded, so main
   * rejects this while a job is running; surface that rather than swallow it.
   */
  processMesh: async (request: MeshProcessRequest): Promise<MeshProcessResult | null> => {
    const electron = api();
    if (!electron) {
      toast.info('Mesh tools need the desktop app');
      return null;
    }
    try {
      return await electron.processMesh(request);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), {
        title: 'Could not process mesh',
      });
      return null;
    }
  },

  cancel: (jobId: string) => api()?.cancelGeneration(jobId),
  clearFinished: () => api()?.clearFinishedJobs(),
  loadModel: (modelId: string) => api()?.loadModel(modelId),
  unloadModel: () => api()?.unloadModel(),
  stopWorker: () => api()?.stopWorker(),
};

export function useGenerationStore(): [GenerationStoreState, typeof generationStore] {
  return [useStore(store), generationStore];
}
