import type * as THREE from 'three';
import type { GenerationJob } from '../../../core/types';
import { currentRevision } from '../../../core/generation';
import { api, createStore, useStore } from '../../stores/createStore';
import { toast } from '../../components/Toast/toastStore';
import { disposeObject, parseMeshBytes } from './meshLoader';
import { fileBaseName, fileExtension } from './format';

/**
 * View-local state for the Generate screen: which job the viewport is showing,
 * and how the scene is drawn. Lives in a module (not component state) so
 * navigating away and back keeps the loaded mesh — the three.js object is
 * retained here and re-attached on mount.
 *
 * The viewer holds no history of its own any more. A job owns its revisions,
 * main owns the files, and this store owns exactly one question: which job is
 * selected. Everything the viewport shows follows from that — the mesh, the
 * caption, and which row the Edit plate acts on — so there is only ever one
 * answer and no way for the plate and the viewport to disagree.
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
  /** The job the viewport shows and the Edit plate acts on. */
  selectedJobId: string | null;
  /**
   * Bumped whenever the selection is asserted from the viewport — a click on
   * the mesh. The queue watches it to bring that row into view and flash it,
   * which is the whole of "clicking the object highlights its job".
   */
  focusTick: number;
}

/**
 * The camera's orientation as a quaternion (x, y, z, w). Published every
 * rendered frame for the navigation gizmo, outside the store so an orbit
 * doesn't re-render the view sixty times a second.
 */
export type CameraPose = readonly [number, number, number, number];

/** What the mounted scene exposes; registered by useThreeScene. */
export interface SceneController {
  setObject(object: THREE.Object3D | null): void;
  resetCamera(): void;
  setGrid(on: boolean): void;
  setWireframe(on: boolean): void;
  setAutoRotate(on: boolean): void;
  /** Swing the camera onto a world axis, keeping its distance and target. */
  snapToAxis(x: number, y: number, z: number): void;
}

type Prefs = Pick<ViewerState, 'showGrid' | 'wireframe' | 'autoRotate'>;
const PREFS_KEY = 'local-mesh:generate-viewer';
const DEFAULT_PREFS: Prefs = { showGrid: true, wireframe: false, autoRotate: false };

function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Record<keyof Prefs, unknown>>;
    const pick = (k: keyof Prefs) => (typeof parsed[k] === 'boolean' ? (parsed[k] as boolean) : DEFAULT_PREFS[k]);
    return { showGrid: pick('showGrid'), wireframe: pick('wireframe'), autoRotate: pick('autoRotate') };
  } catch {
    return DEFAULT_PREFS;
  }
}

function writePrefs(s: ViewerState) {
  try {
    const prefs: Prefs = { showGrid: s.showGrid, wireframe: s.wireframe, autoRotate: s.autoRotate };
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

const store = createStore<ViewerState>({
  loaded: null,
  loading: null,
  selectedJobId: null,
  focusTick: 0,
  ...readPrefs(),
});

let controller: SceneController | null = null;
let currentObject: THREE.Object3D | null = null;
let loadToken = 0;

// Camera orientation channel. Kept off the store deliberately: the gizmo is
// the only reader and it writes straight to the DOM, so an orbit costs no
// React work at all.
let cameraPose: CameraPose = [0, 0, 0, 1];
const poseListeners = new Set<(pose: CameraPose) => void>();

// The last queue snapshot, so select() can resolve a job id to a file without
// every caller having to hand the list back in.
let latestJobs: readonly GenerationJob[] = [];
/** The path the selection currently implies; guards against reloading the same file. */
let shownPath: string | null = null;
/** Jobs already finished when the view first saw the queue: not fresh results. */
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

function findJob(jobId: string | null): GenerationJob | null {
  return jobId ? (latestJobs.find((j) => j.id === jobId) ?? null) : null;
}

/** Show whatever the current selection points at, or nothing. */
function showSelection() {
  const job = findJob(store.getState().selectedJobId);
  const path = job ? (currentRevision(job)?.path ?? null) : null;
  if (path === shownPath) return;
  shownPath = path;
  if (path) void viewerStore.load(path);
  else viewerStore.clear();
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
   * Read a mesh and show it. A newer call supersedes an older one, so a burst
   * of revision steps settles on the last one asked for rather than whichever
   * file happened to parse fastest.
   */
  async load(path: string): Promise<void> {
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
      // Hand the new object to the scene before freeing the old one: three
      // keeps rendering whatever is still in the graph, and a disposed
      // geometry that is still attached draws with dead GPU buffers.
      const previous = currentObject;
      currentObject = parsed.object;
      controller?.setObject(currentObject);
      if (previous) disposeObject(previous);
      store.setState({
        loaded: { path, name: fileBaseName(path), vertices: parsed.vertices, faces: parsed.faces },
        loading: null,
      });
    } catch (err) {
      if (token !== loadToken) return;
      store.setState({ loading: null });
      toast.error(err instanceof Error ? err.message : String(err), { title: 'Could not load mesh' });
    }
  },

  clear() {
    loadToken += 1;
    const previous = currentObject;
    currentObject = null;
    controller?.setObject(null);
    if (previous) disposeObject(previous);
    store.setState({ loaded: null, loading: null });
  },

  /** True when the viewport is actually drawing something clickable. */
  hasObject: () => currentObject !== null,

  /** Point the viewport at a job. The row, the outputs list and the caption all call this. */
  select(jobId: string | null) {
    if (store.getState().selectedJobId !== jobId) store.setState({ selectedJobId: jobId });
    showSelection();
  },

  /**
   * The mesh in the viewport was clicked. It belongs to the selected job by
   * construction — the scene is single-object — so this only has to say so
   * out loud, which the queue turns into "scroll that row into view and flash
   * it".
   */
  pingSelection() {
    if (!store.getState().selectedJobId) return;
    store.setState((prev) => ({ focusTick: prev.focusTick + 1 }));
  },

  /**
   * Reconcile the selection against a fresh queue snapshot. Called from the
   * view on every push, and responsible for three things a user would
   * otherwise have to do by hand: keep showing the selected job as its
   * revisions change, jump to a job the moment it finishes, and fall back to
   * something sensible when the selected job is saved or deleted.
   */
  syncFromJobs(jobs: readonly GenerationJob[]) {
    latestJobs = jobs;
    const withMesh = jobs.filter((j) => j.revisions.length > 0);

    if (!primed) {
      // A restart replays every finished job at once; none of them is news.
      primed = true;
      jobs.forEach((j) => {
        if (j.status === 'done') seenDone.add(j.id);
      });
      const resume = withMesh.at(-1);
      if (resume) store.setState({ selectedJobId: resume.id });
      showSelection();
      return;
    }

    const fresh = jobs.filter((j) => j.status === 'done' && !seenDone.has(j.id));
    fresh.forEach((j) => seenDone.add(j.id));
    // Work you waited for should be the work you are looking at.
    const newest = fresh.filter((j) => j.revisions.length > 0).at(-1);
    if (newest) store.setState({ selectedJobId: newest.id });
    else if (!findJob(store.getState().selectedJobId)) {
      store.setState({ selectedJobId: withMesh.at(-1)?.id ?? null });
    }
    showSelection();
  },

  resetCamera: () => controller?.resetCamera(),

  /** Snap the camera onto a world axis; the gizmo's handles are the callers. */
  snapToAxis: (x: number, y: number, z: number) => controller?.snapToAxis(x, y, z),

  /** Called by the scene after every render it draws. */
  publishCameraPose(pose: CameraPose) {
    cameraPose = pose;
    poseListeners.forEach((listener) => listener(pose));
  },

  /** Fires on every camera move, and once immediately with the current pose. */
  subscribeCameraPose(listener: (pose: CameraPose) => void): () => void {
    poseListeners.add(listener);
    listener(cameraPose);
    return () => {
      poseListeners.delete(listener);
    };
  },

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

  /**
   * Show a file that is not a job's — an entry in the outputs list. The
   * selection is dropped, because the Edit plate must not offer to edit a
   * saved file as if it were still a job.
   */
  async preview(path: string): Promise<void> {
    store.setState({ selectedJobId: null });
    shownPath = path;
    await viewerStore.load(path);
  },

  /** Drop the viewer's copy if the file behind it goes away. */
  forget(path: string) {
    if (store.getState().loaded?.path === path) {
      shownPath = null;
      viewerStore.clear();
    }
  },
};

export function useViewerStore(): [ViewerState, typeof viewerStore] {
  return [useStore(store), viewerStore];
}
