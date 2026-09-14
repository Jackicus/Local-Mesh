import type { ModelDownloadProgress, ModelInstallState } from '../../core/types';
import { MODELS } from '../../core/models';
import { api, createStore, useStore } from './createStore';
import { toast } from '../components/Toast/toastStore';

/**
 * Install state per registry model plus live download progress. `installs`
 * is refreshed from main after every download/delete; `downloads` is fed by
 * push events and cleared when a download finishes or fails.
 */
export interface ModelStoreState {
  hydrated: boolean;
  installs: Record<string, ModelInstallState>;
  downloads: Record<string, ModelDownloadProgress>;
}

const store = createStore<ModelStoreState>({ hydrated: false, installs: {}, downloads: {} });

let bound = false;

async function refresh() {
  const electron = api();
  if (!electron) return;
  const list = await electron.listModels();
  store.setState({ hydrated: true, installs: Object.fromEntries(list.map((m) => [m.id, m])) });
}

export const modelStore = {
  ...store,

  bind: () => {
    const electron = api();
    if (bound || !electron) return;
    bound = true;
    electron.onModelDownloadProgress((event) => {
      store.setState((prev) => ({ downloads: { ...prev.downloads, [event.modelId]: event } }));
      if (event.status === 'done' || event.status === 'failed' || event.status === 'cancelled') {
        const name = MODELS.find((m) => m.id === event.modelId)?.name ?? event.modelId;
        const what = event.kind === 'deps' ? 'dependencies installed' : 'weights downloaded';
        if (event.status === 'done') toast.success(`${name}: ${what}`);
        if (event.status === 'failed') toast.error(event.error ?? `${event.kind === 'deps' ? 'Install' : 'Download'} failed`, { title: name });
        void refresh();
        // Leave the terminal state visible briefly, then drop it.
        setTimeout(() => {
          store.setState((prev) => {
            if (prev.downloads[event.modelId]?.status !== event.status) return {};
            const { [event.modelId]: _dropped, ...rest } = prev.downloads;
            return { downloads: rest };
          });
        }, 4000);
      }
    });
    void refresh();
  },

  refresh,

  download: async (modelId: string) => {
    const electron = api();
    if (!electron) return;
    try {
      await electron.downloadModel(modelId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), { title: 'Download failed' });
    }
  },

  installDeps: async (modelId: string) => {
    const electron = api();
    if (!electron) return;
    try {
      await electron.installModelDeps(modelId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), { title: 'Install failed' });
    }
  },

  cancelDownload: (modelId: string) => api()?.cancelModelDownload(modelId),

  remove: async (modelId: string) => {
    const electron = api();
    if (!electron) return;
    await electron.deleteModel(modelId);
    await refresh();
  },

  /** Convenience for the Generate view: can this model run right now? */
  isReady: (modelId: string): boolean => store.getState().installs[modelId]?.ready ?? false,
};

export function useModelStore(): [ModelStoreState, typeof modelStore] {
  return [useStore(store), modelStore];
}
