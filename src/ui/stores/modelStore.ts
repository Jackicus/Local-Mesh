import type { ModelDownloadProgress, ModelInstallState } from '../../core/types';
import { MODELS } from '../../core/models';
import { api, createStore, useStore } from './createStore';
import { envStore } from './envStore';
import { toast } from '../components/Toast/toastStore';

/** Which leg of a chained install is in flight. */
export type InstallStepKey = 'engine' | 'weights' | 'deps';

/** The one install running right now, and how far along the chain it is. */
export interface InstallChain {
  modelId: string;
  step: InstallStepKey;
}

/**
 * Install state per registry model plus live download progress. `installs`
 * is refreshed from main after every download/delete; `downloads` is fed by
 * push events and cleared when a download finishes or fails.
 *
 * `chain` is whichever leg of an install is in flight. Only one ever is —
 * they would fight over the same environment — so it is a single slot rather
 * than a map, and the Models view reads it to know what to say and what to
 * hold still.
 */
export interface ModelStoreState {
  hydrated: boolean;
  installs: Record<string, ModelInstallState>;
  downloads: Record<string, ModelDownloadProgress>;
  chain: InstallChain | null;
}

const store = createStore<ModelStoreState>({ hydrated: false, installs: {}, downloads: {}, chain: null });

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
        // The user pressed "Get the model files" or "Set it up"; the message
        // that comes back says that thing happened, in those words. No venv,
        // no packages, no step numbers.
        const what = event.kind === 'deps' ? 'is ready to run' : 'files are downloaded';
        if (event.status === 'done') toast.success(`${name} ${what}`);
        if (event.status === 'failed') {
          toast.error(event.error ?? (event.kind === 'deps' ? 'Setting it up failed' : 'The download failed'), {
            title: name,
          });
        }
        void refresh();
        // Leave the terminal state visible briefly, then drop it — except a
        // failure, which stays until the next attempt: once the toast has gone
        // the card is the only place the reason is still readable.
        if (event.status !== 'failed') {
          setTimeout(() => {
            store.setState((prev) => {
              if (prev.downloads[event.modelId]?.status !== event.status) return {};
              const { [event.modelId]: _dropped, ...rest } = prev.downloads;
              return { downloads: rest };
            });
          }, 4000);
        }
      }
    });
    void refresh();
  },

  refresh,

  /** Drop a finished/failed progress entry, so a retry starts from a clean slate. */
  forgetDownload: (modelId: string) =>
    store.setState((prev) => {
      if (!prev.downloads[modelId]) return {};
      const { [modelId]: _dropped, ...rest } = prev.downloads;
      return { downloads: rest };
    }),

  download: async (modelId: string) => {
    const electron = api();
    if (!electron) return;
    modelStore.forgetDownload(modelId);
    try {
      await electron.downloadModel(modelId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), { title: 'Could not download' });
    }
  },

  installDeps: async (modelId: string) => {
    const electron = api();
    if (!electron) return;
    modelStore.forgetDownload(modelId);
    try {
      await electron.installModelDeps(modelId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), { title: 'Could not set it up' });
    }
  },

  /** Stop whichever leg is running. */
  cancelInstall: async (modelId: string) => {
    const chain = store.getState().chain;
    if (chain?.modelId === modelId && chain.step === 'engine') {
      envStore.cancelSetup();
      return;
    }
    await api()?.cancelModelDownload(modelId);
  },

  cancelDownload: (modelId: string) => api()?.cancelModelDownload(modelId),

  remove: async (modelId: string) => {
    const electron = api();
    if (!electron) return;
    await electron.deleteModel(modelId);
    await refresh();
  },
};

export function useModelStore(): [ModelStoreState, typeof modelStore] {
  return [useStore(store), modelStore];
}
