import type { Pipeline, PipelineSummary } from '../../core/types';
import { createDefaultPipeline, summarizePipeline } from '../../core/pipeline';
import { api, createStore, useStore } from './createStore';
import { toast } from '../components/Toast/toastStore';

/**
 * Saved pipelines (node graphs). The list is summaries; the Pipelines view
 * loads the full graph it is editing, and the Generate view tracks which one
 * to run via `selectedId` (persisted in localStorage).
 */
export interface PipelineStoreState {
  hydrated: boolean;
  list: PipelineSummary[];
  /** The pipeline the Generate view will run. */
  selectedId: string | null;
}

const SELECTED_KEY = 'local-mesh:selected-pipeline';

function readSelected(): string | null {
  try {
    return localStorage.getItem(SELECTED_KEY);
  } catch {
    return null;
  }
}

const store = createStore<PipelineStoreState>({
  hydrated: false,
  list: [],
  selectedId: readSelected(),
});

let bound = false;

async function refresh() {
  const electron = api();
  if (!electron) return;
  let list = await electron.listPipelines();
  if (list.length === 0) {
    // First launch: seed the canonical chain so Generate works out of the box.
    const p = createDefaultPipeline('Default');
    await electron.writePipeline(p);
    list = [summarizePipeline(p)];
  }
  const selectedId = store.getState().selectedId;
  const selected = list.some((p) => p.id === selectedId) ? selectedId : list[0]?.id ?? null;
  store.setState({ hydrated: true, list, selectedId: selected });
}

export const pipelineStore = {
  ...store,

  bind: () => {
    if (bound || !api()) return;
    bound = true;
    void refresh();
  },

  refresh,

  select: (id: string | null) => {
    store.setState({ selectedId: id });
    try {
      if (id) localStorage.setItem(SELECTED_KEY, id);
      else localStorage.removeItem(SELECTED_KEY);
    } catch {}
  },

  read: (id: string): Promise<Pipeline | null> => api()?.readPipeline(id) ?? Promise.resolve(null),

  /** Persist a full pipeline and refresh the summary list. */
  save: async (pipeline: Pipeline): Promise<boolean> => {
    const electron = api();
    if (!electron) return false;
    const ok = await electron.writePipeline({ ...pipeline, updatedAt: Date.now() });
    if (!ok) toast.error('Could not save pipeline');
    await refresh();
    return ok;
  },

  create: async (name = 'New pipeline'): Promise<Pipeline | null> => {
    const p = createDefaultPipeline(name);
    const ok = await pipelineStore.save(p);
    return ok ? p : null;
  },

  duplicate: async (id: string): Promise<Pipeline | null> => {
    const source = await pipelineStore.read(id);
    if (!source) return null;
    const now = Date.now();
    const copy: Pipeline = {
      ...source,
      id: `pipeline-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: `${source.name} copy`,
      createdAt: now,
      updatedAt: now,
    };
    const ok = await pipelineStore.save(copy);
    return ok ? copy : null;
  },

  remove: async (id: string) => {
    const electron = api();
    if (!electron) return;
    await electron.deletePipeline(id);
    if (store.getState().selectedId === id) pipelineStore.select(null);
    await refresh();
  },
};

export function usePipelineStore(): [PipelineStoreState, typeof pipelineStore] {
  return [useStore(store), pipelineStore];
}
