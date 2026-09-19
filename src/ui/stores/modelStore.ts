import type { ModelDownloadProgress, ModelInstallState } from '../../core/types';
import { MODELS, getModel } from '../../core/models';
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
 * `chain` is the whole point of the Install button: a model needs the engine,
 * its weights and its own packages, and every surface in the app treats that
 * as one action. Only one chain runs at a time — they would fight over the
 * same venv — so this is a single slot, not a map.
 */
export interface ModelStoreState {
  hydrated: boolean;
  installs: Record<string, ModelInstallState>;
  downloads: Record<string, ModelDownloadProgress>;
  chain: InstallChain | null;
}

const store = createStore<ModelStoreState>({ hydrated: false, installs: {}, downloads: {}, chain: null });

let bound = false;

/**
 * True while `install()` is driving the chain. The per-step success toasts are
 * suppressed while it is: one button press should produce one message at the
 * end, not three as each leg lands.
 */
let chaining = false;

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
        // Mid-chain successes stay quiet; install() speaks once at the end.
        if (event.status === 'done' && !chaining) toast.success(`${name}: ${what}`);
        if (event.status === 'failed') toast.error(event.error ?? `${event.kind === 'deps' ? 'Install' : 'Download'} failed`, { title: name });
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
      toast.error(err instanceof Error ? err.message : String(err), { title: 'Download failed' });
    }
  },

  installDeps: async (modelId: string) => {
    const electron = api();
    if (!electron) return;
    modelStore.forgetDownload(modelId);
    try {
      await electron.installModelDeps(modelId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), { title: 'Install failed' });
    }
  },

  /**
   * The one button. Runs every leg this model still needs — engine, weights,
   * packages — back to back, and stops at the first one that does not land.
   *
   * Each leg already reports its own failure (a toast from the progress event,
   * or from envStore.setup), so a leg that fails is not re-announced here: the
   * chain just stops and leaves the card showing what is still outstanding.
   */
  install: async (modelId: string) => {
    const electron = api();
    const model = getModel(modelId);
    if (!electron || !model || store.getState().chain) return;

    const needsWeights = model.hfRepo !== '';
    const needsDeps = model.requirements !== null;
    // The mock backend is pure python: it needs the venv to exist, not torch.
    const engineDone = () => {
      const status = envStore.getState().status;
      return Boolean(needsWeights || needsDeps ? status?.ready : status?.envExists);
    };

    chaining = true;
    try {
      if (!engineDone()) {
        store.setState({ chain: { modelId, step: 'engine' } });
        await envStore.setup();
        await envStore.refresh();
        if (!engineDone()) return;
      }

      if (needsWeights && (store.getState().installs[modelId]?.weights ?? 'none') !== 'complete') {
        store.setState({ chain: { modelId, step: 'weights' } });
        await modelStore.download(modelId);
        await refresh();
        if ((store.getState().installs[modelId]?.weights ?? 'none') !== 'complete') return;
      }

      if (needsDeps && (store.getState().installs[modelId]?.deps ?? 'unknown') !== 'installed') {
        store.setState({ chain: { modelId, step: 'deps' } });
        await modelStore.installDeps(modelId);
        await refresh();
        if ((store.getState().installs[modelId]?.deps ?? 'unknown') !== 'installed') return;
      }

      toast.success(`${model.name} is ready to use`);
    } finally {
      chaining = false;
      store.setState({ chain: null });
      await refresh();
    }
  },

  /** Stop whatever leg of the chain is running. */
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

  /** Convenience for the Generate view: can this model run right now? */
  isReady: (modelId: string): boolean => store.getState().installs[modelId]?.ready ?? false,
};

export function useModelStore(): [ModelStoreState, typeof modelStore] {
  return [useStore(store), modelStore];
}
