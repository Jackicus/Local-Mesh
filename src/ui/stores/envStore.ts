import type { EnvProgressEvent, EnvStatus, LocalMeshPaths } from '../../core/types';
import { api, createStore, useStore } from './createStore';
import { toast } from '../components/Toast/toastStore';

/**
 * Python environment status (uv, venv, torch/CUDA probe) plus the live
 * setup progress stream and the ~/.local-mesh path map.
 */
export interface EnvStoreState {
  hydrated: boolean;
  status: EnvStatus | null;
  paths: LocalMeshPaths | null;
  /** True while setupEnv() is in flight. */
  settingUp: boolean;
  progress: EnvProgressEvent | null;
  /** Last ~300 raw lines from uv/pip during setup, oldest first. */
  setupLines: string[];
}

const store = createStore<EnvStoreState>({
  hydrated: false,
  status: null,
  paths: null,
  settingUp: false,
  progress: null,
  setupLines: [],
});

let bound = false;

async function refresh() {
  const electron = api();
  if (!electron) return;
  const [status, paths] = await Promise.all([electron.getEnvStatus(), electron.getPaths()]);
  store.setState({ hydrated: true, status, paths });
}

export const envStore = {
  ...store,

  bind: () => {
    const electron = api();
    if (bound || !electron) return;
    bound = true;
    electron.onEnvProgress((event) => {
      store.setState((prev) => ({
        progress: event,
        setupLines: event.line ? [...prev.setupLines.slice(-299), event.line] : prev.setupLines,
      }));
    });
    void refresh();
  },

  refresh,

  setup: async () => {
    const electron = api();
    if (!electron || store.getState().settingUp) return;
    store.setState({ settingUp: true, setupLines: [], progress: null });
    try {
      await electron.setupEnv();
      toast.success('Python environment ready');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), { title: 'Environment setup failed' });
    } finally {
      store.setState({ settingUp: false });
      await refresh();
    }
  },

  cancelSetup: () => api()?.cancelEnvSetup(),

  remove: async () => {
    const electron = api();
    if (!electron) return;
    await electron.removeEnv();
    await refresh();
  },
};

export function useEnvStore(): [EnvStoreState, typeof envStore] {
  return [useStore(store), envStore];
}
