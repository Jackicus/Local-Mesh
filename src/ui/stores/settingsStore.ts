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
/** Bumped per update() so a slow reply cannot overwrite a newer one. */
let writeSeq = 0;

export const settingsStore = {
  ...store,

  bind: () => {
    const electron = api();
    if (bound || !electron) return;
    bound = true;
    electron.getSettings().then((settings) => {
      // An update() issued before this resolved has already applied a newer
      // patch optimistically; don't undo it with the pre-edit snapshot.
      if (writeSeq > 0) {
        store.setState({ hydrated: true });
        return;
      }
      store.setState({ hydrated: true, settings });
    });
  },

  update: async (patch: Partial<AppSettings>) => {
    // Optimistic; main returns the merged, validated result.
    store.setState((prev) => ({ settings: { ...prev.settings, ...patch } }));
    const electron = api();
    if (!electron) return;
    const seq = ++writeSeq;
    const settings = await electron.setSettings(patch);
    if (seq !== writeSeq) return; // a later update() is in flight; its reply wins
    store.setState({ settings });
  },
};

export function useSettingsStore(): [SettingsStoreState, typeof settingsStore] {
  return [useStore(store), settingsStore];
}
