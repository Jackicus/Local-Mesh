import type * as THREE from 'three';
import type { GenerationJob } from '../../../core/types';
import { api, createStore, useStore } from '../../stores/createStore';
import { toast } from '../../components/Toast/toastStore';
import { disposeObject, parseMeshBytes } from './meshLoader';
import { fileBaseName, fileExtension } from './format';

/**
 * View-local state for the Generate screen: what the viewport shows, the
 * viewer toggles, the dock, and the images waiting to be queued. Lives in a
 * module (not component state) so navigating away and back keeps the loaded
 * mesh — the three.js object is retained here and re-attached on mount.
 */
export interface LoadedMesh {
  path: string;
  name: string;
  vertices: number;
  faces: number;
}

export interface ViewerState {
  loaded: LoadedMesh | null;
  /** Path being read and parsed right now, or null. */
  loading: string | null;
  showGrid: boolean;
  wireframe: boolean;
  autoRotate: boolean;
  dockOpen: boolean;
  /** Absolute paths of source images picked or dropped, not yet queued. */
  images: string[];
  /**
   * Paths superseded by the mesh tools, oldest first — one step back per entry.
   * Reset whenever the viewer is pointed at an unrelated mesh.
   */
  history: string[];
  /** Bumped when a tool writes a new file, so the outputs list knows to re-read. */
  outputsRevision: number;
  /** Which mesh tool is mid-run; mirrored in the HUD until main reports progress. */
  toolBusy: 'reduce' | 'smooth' | 'undo' | null;
}

/** What the mounted scene exposes; registered by useThreeScene. */
export interface SceneController {
  setObject(object: THREE.Object3D | null): void;
  resetCamera(): void;
  setGrid(on: boolean): void;
  setWireframe(on: boolean): void;
  setAutoRotate(on: boolean): void;
}

type Prefs = Pick<ViewerState, 'showGrid' | 'wireframe' | 'autoRotate' | 'dockOpen'>;
const PREFS_KEY = 'local-mesh:generate-viewer';
const DEFAULT_PREFS: Prefs = { showGrid: true, wireframe: false, autoRotate: false, dockOpen: true };

function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Record<keyof Prefs, unknown>>;
    const pick = (k: keyof Prefs) => (typeof parsed[k] === 'boolean' ? (parsed[k] as boolean) : DEFAULT_PREFS[k]);
    return { showGrid: pick('showGrid'), wireframe: pick('wireframe'), autoRotate: pick('autoRotate'), dockOpen: pick('dockOpen') };
  } catch {
    return DEFAULT_PREFS;
  }
}

function writePrefs(s: ViewerState) {
  try {
    const prefs: Prefs = { showGrid: s.showGrid, wireframe: s.wireframe, autoRotate: s.autoRotate, dockOpen: s.dockOpen };
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

const store = createStore<ViewerState>({
  loaded: null,
  loading: null,
  images: [],
  history: [],
  outputsRevision: 0,
  toolBusy: null,
  ...readPrefs(),
});

let controller: SceneController | null = null;
let currentObject: THREE.Object3D | null = null;
let loadToken = 0;

// Auto-load bookkeeping: jobs already finished when the view first sees the
// queue are seeded as "seen" so a restart doesn't replay old results.
const seenDone = new Set<string>();
let primed = false;

function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  store.setState({ [key]: value } as Pick<ViewerState, K>);
  writePrefs(store.getState());
}

function toArrayBuffer(bytes: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice().buffer;
  }
  return bytes;
}

export const viewerStore = {
  ...store,

  registerController(next: SceneController): () => void {
    controller = next;
    const s = store.getState();
    next.setGrid(s.showGrid);
    next.setWireframe(s.wireframe);
    next.setAutoRotate(s.autoRotate);
    next.setObject(currentObject);
    return () => {
      if (controller === next) controller = null;
    };
  },

  /**
   * Read a mesh from outputs/ and show it. A newer call supersedes an older
   * one. `keepHistory` is for the mesh tools, which walk a chain of files that
   * belong together; any other load starts a fresh chain.
   */
  async load(path: string, options?: { keepHistory?: boolean }): Promise<void> {
    const electron = api();
    if (!electron) {
      toast.info('Viewing meshes needs the desktop app');
      return;
    }
    const token = ++loadToken;
    store.setState({ loading: path });
    try {
      const bytes = await electron.readOutputFile(path);
      if (!bytes) throw new Error('The file could not be read. It may have been moved or deleted.');
      const parsed = await parseMeshBytes(toArrayBuffer(bytes), fileExtension(path));
      if (token !== loadToken) {
        disposeObject(parsed.object);
        return;
      }
      if (currentObject) disposeObject(currentObject);
      currentObject = parsed.object;
      controller?.setObject(currentObject);
      store.setState((prev) => ({
        loaded: { path, name: fileBaseName(path), vertices: parsed.vertices, faces: parsed.faces },
        loading: null,
        history: options?.keepHistory ? prev.history : [],
      }));
    } catch (err) {
      if (token !== loadToken) return;
      store.setState({ loading: null });
      toast.error(err instanceof Error ? err.message : String(err), { title: 'Could not load mesh' });
    }
  },

  clear() {
    loadToken += 1;
    if (currentObject) disposeObject(currentObject);
    currentObject = null;
    controller?.setObject(null);
    store.setState({ loaded: null, loading: null, history: [] });
  },

  /**
   * Show the file a tool just wrote and remember what it replaced. Only
   * records the step if the new file actually loaded.
   */
  async applyProcessed(previousPath: string, nextPath: string): Promise<void> {
    await viewerStore.load(nextPath, { keepHistory: true });
    if (store.getState().loaded?.path !== nextPath) return;
    store.setState((prev) => ({
      history: [...prev.history, previousPath],
      outputsRevision: prev.outputsRevision + 1,
    }));
  },

  /** Step back to the file before the last tool run. */
  async undo(): Promise<void> {
    const previous = store.getState().history.at(-1);
    if (!previous) return;
    await viewerStore.load(previous, { keepHistory: true });
    if (store.getState().loaded?.path !== previous) return;
    store.setState((prev) => ({ history: prev.history.slice(0, -1) }));
  },

  setToolBusy: (tool: ViewerState['toolBusy']) => store.setState({ toolBusy: tool }),

  /** Drop the viewer's copy if the file behind it goes away. */
  forget(path: string) {
    if (store.getState().loaded?.path === path) viewerStore.clear();
  },

  resetCamera: () => controller?.resetCamera(),

  setGrid(on: boolean) {
    setPref('showGrid', on);
    controller?.setGrid(on);
  },
  setWireframe(on: boolean) {
    setPref('wireframe', on);
    controller?.setWireframe(on);
  },
  setAutoRotate(on: boolean) {
    setPref('autoRotate', on);
    controller?.setAutoRotate(on);
  },
  setDockOpen: (open: boolean) => setPref('dockOpen', open),

  addImages(paths: string[]) {
    store.setState((prev) => ({ images: [...prev.images, ...paths.filter((p) => !prev.images.includes(p))] }));
  },
  removeImage(path: string) {
    store.setState((prev) => ({ images: prev.images.filter((p) => p !== path) }));
  },
  clearImages: () => store.setState({ images: [] }),

  /** Show the newest job that finished since the last call. Call only once hydrated. */
  autoLoadFrom(jobs: GenerationJob[]) {
    const done = jobs.filter((j) => j.status === 'done' && j.outputPath);
    if (!primed) {
      primed = true;
      done.forEach((j) => seenDone.add(j.id));
      return;
    }
    const fresh = done.filter((j) => !seenDone.has(j.id));
    if (fresh.length === 0) return;
    fresh.forEach((j) => seenDone.add(j.id));
    const newest = fresh.reduce((a, b) => ((b.finishedAt ?? 0) > (a.finishedAt ?? 0) ? b : a));
    void viewerStore.load(newest.outputPath!);
  },
};

export function useViewerStore(): [ViewerState, typeof viewerStore] {
  return [useStore(store), viewerStore];
}
