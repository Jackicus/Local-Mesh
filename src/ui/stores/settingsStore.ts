import type { AppSettings } from '../../core/types';
import { DEFAULT_SETTINGS } from '../../core/env';
import { api, createStore, useStore } from './createStore';

/** App settings persisted by main in ~/.local-mesh/settings.json. */
export interface SettingsStoreState {
  hydrated: boolean;
  settings: AppSettings;
}

const store = createStore<SettingsStoreState>({ hydrated: false, settings: DEFAULT_SETTINGS });

let bound = false;

export const settingsStore = {
  ...store,

  bind: () => {
    const electron = api();
    if (bound || !electron) return;
    bound = true;
    electron.getSettings().then((settings) => store.setState({ hydrated: true, settings }));
  },

  update: async (patch: Partial<AppSettings>) => {
    // Optimistic; main returns the merged, validated result.
    store.setState((prev) => ({ settings: { ...prev.settings, ...patch } }));
    const electron = api();
    if (!electron) return;
    const settings = await electron.setSettings(patch);
    store.setState({ settings });
  },
};

export function useSettingsStore(): [SettingsStoreState, typeof settingsStore] {
  return [useStore(store), settingsStore];
}
