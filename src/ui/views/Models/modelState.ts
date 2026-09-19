/**
 * What a model needs before it runs, and the one thing to press about it.
 *
 * A model only runs when three independent things are true:
 *
 *   1. engine — the Python environment exists (shared by every model)
 *   2. files  — this model's weights are on disk (plain download, needs no env)
 *   3. extras — this model's Python packages are installed into the engine
 *
 * That used to be three buttons and a progress track on the front of every
 * card, which is plumbing: nobody installing an app wants to know it has a
 * venv. `modelStore.install()` now runs all three back to back, so this module
 * derives ONE action ("Install" / "Stop" / "Try again") and ONE plain-language
 * line about whatever is happening. The per-step detail survives as `steps`,
 * which only the expanded details panel renders.
 */
import type {
  EnvProgressEvent,
  ModelDefinition,
  ModelDownloadProgress,
  ModelInstallState,
} from '../../../core/types';
import type { InstallChain } from '../../stores/modelStore';
import { PHASE_LABEL, STEP_HELP } from './copy';
import { formatGb, gbToBytes } from './formatBytes';

export type StepKey = 'engine' | 'files' | 'extras';
export type StepStatus = 'done' | 'running' | 'todo' | 'blocked' | 'failed';

export interface InstallStep {
  key: StepKey;
  label: string;
  status: StepStatus;
  /** The state in a word or two: "Installed", "Not downloaded", "4.1 GB of 7.7 GB". */
  state: string;
  /** What this step is, for the expanded view. */
  help: string;
}

export type FitVerdict = 'fits' | 'tight' | 'over' | 'unknown';

export interface Fit {
  verdict: FitVerdict;
  label: string;
  detail: string;
  variant: 'success' | 'warning' | 'danger' | 'neutral';
}

/**
 * The one line shown while an install runs. Whichever leg is in flight, this
 * says the same kind of thing in the same place, so the card never appears to
 * restart from zero three times.
 */
export interface LiveInstall {
  label: string;
  pct: number;
  indeterminate: boolean;
  failed: boolean;
  /** Set only while weights are moving, so the bytes/rate/ETA line can render. */
  transfer: ModelDownloadProgress | null;
  /** The noisy per-file or per-package line. Never the thing you read first. */
  detail: string | null;
}

/** What pressing the one primary button does. */
export type ActionKind = 'install' | 'cancel' | 'retry';

export interface ModelState {
  steps: InstallStep[];
  stepsDone: number;
  /** True when all three are satisfied and the model can actually run. */
  ready: boolean;
  /** Some leg of this model's install is in flight. */
  running: boolean;
  /** The single live line, or the failure that just happened. */
  live: LiveInstall | null;
  /** The badge on the collapsed row. */
  status: { label: string; variant: 'success' | 'accent' | 'warning' | 'danger' | 'neutral' };
  /** The single next thing to do, or null when there is nothing left. */
  action: { kind: ActionKind; label: string } | null;
  /**
   * The one prerequisite the app genuinely cannot install for you: uv. Null
   * whenever pressing Install would get somewhere.
   */
  blocked: string | null;
  fit: Fit | null;
}

const RUNNING: ModelDownloadProgress['status'][] = ['starting', 'downloading', 'installing-deps'];

/** Does this card have the memory? Null for models that never touch the GPU. */
export function fitFor(model: ModelDefinition, vramTotalBytes: number | null): Fit | null {
  if (model.vramGb <= 0) return null;
  const needs = `Needs about ${model.vramGb} GB of graphics memory`;
  if (vramTotalBytes == null) {
    return {
      verdict: 'unknown',
      label: 'Not checked yet',
      detail: `${needs}. Install it and Local Mesh can tell you whether your card has the room.`,
      variant: 'neutral',
    };
  }
  const has = `your card has ${formatGb(vramTotalBytes)}`;
  const need = gbToBytes(model.vramGb);
  if (need <= vramTotalBytes * 0.8) {
    return { verdict: 'fits', label: 'Fits your card', detail: `${needs}; ${has}.`, variant: 'success' };
  }
  if (need <= vramTotalBytes) {
    return {
      verdict: 'tight',
      label: 'Tight fit',
      detail: `${needs}; ${has}. It should run, but leave the graphics card alone while it does.`,
      variant: 'warning',
    };
  }
  return {
    verdict: 'over',
    label: 'Too big for your card',
    detail: `${needs}; ${has}. It will most likely run out of memory part-way through.`,
    variant: 'danger',
  };
}

export interface DeriveInput {
  model: ModelDefinition;
  install?: ModelInstallState;
  download?: ModelDownloadProgress;
  envReady: boolean;
  envBusy: boolean;
  /** Live phase/percent while the shared engine is being built. */
  envProgress?: EnvProgressEvent | null;
  /** uv is not on PATH, so nothing can be installed until the user fixes it. */
  uvMissing?: boolean;
  /** The chained install running right now, for any model. */
  chain?: InstallChain | null;
  vramTotalBytes: number | null;
}

export function deriveModelState({
  model,
  install,
  download,
  envReady,
  envBusy,
  envProgress,
  uvMissing = false,
  chain = null,
  vramTotalBytes,
}: DeriveInput): ModelState {
  const needsFiles = model.hfRepo !== '';
  const needsExtras = model.requirements !== null;
  const weights = install?.weights ?? 'none';
  const deps = install?.deps ?? 'unknown';

  const live = download && RUNNING.includes(download.status) ? download : undefined;
  const failed = download?.status === 'failed' ? download : undefined;
  const downloading = live?.kind === 'weights';
  const installing = live?.kind === 'deps';
  const mine = chain?.modelId === model.id;
  // The engine leg has no per-model progress event: it is this model's only
  // while this model is the one that asked for it.
  const onEngine = mine && chain?.step === 'engine';

  const steps: InstallStep[] = [];

  steps.push({
    key: 'engine',
    label: 'Shared setup',
    status: envReady ? 'done' : envBusy || onEngine ? 'running' : 'todo',
    state: envReady ? 'Installed' : envBusy || onEngine ? 'Installing…' : 'Not installed',
    help: STEP_HELP.engine,
  });

  if (needsFiles) {
    steps.push({
      key: 'files',
      label: 'Model files',
      status: weights === 'complete' ? 'done' : downloading ? 'running' : failed?.kind === 'weights' ? 'failed' : 'todo',
      state:
        weights === 'complete'
          ? 'Downloaded'
          : downloading
            ? 'Downloading…'
            : failed?.kind === 'weights'
              ? weights === 'partial'
                ? 'Download failed — part of it is on disk'
                : 'Download failed'
              : weights === 'partial'
                ? 'Part downloaded'
                : `${model.diskGb} GB to download`,
      help: STEP_HELP.files,
    });
  }

  if (needsExtras) {
    steps.push({
      key: 'extras',
      label: 'Finishing touches',
      status:
        deps === 'installed'
          ? 'done'
          : installing
            ? 'running'
            : failed?.kind === 'deps'
              ? 'failed'
              : envReady
                ? 'todo'
                : 'blocked',
      state:
        deps === 'installed'
          ? 'Installed'
          : installing
            ? 'Installing…'
            : failed?.kind === 'deps'
              ? 'Install failed'
              : envReady
                ? 'Not installed'
                : 'Waiting for the shared setup',
      help: STEP_HELP.extras,
    });
  }

  const stepsDone = steps.filter((s) => s.status === 'done').length;
  const ready = stepsDone === steps.length;
  const running = Boolean(live) || onEngine;

  // One line for the whole chain, whichever leg is actually moving. The engine
  // leg is the long one and the one nobody expects, so it says out loud that it
  // happens once and is shared.
  let liveLine: LiveInstall | null = null;
  if (onEngine) {
    const phase = envProgress?.phase ?? 'checking';
    liveLine = {
      label: 'Setting up — this part happens once, and every model shares it',
      pct: envProgress?.pct ?? 0,
      indeterminate: !envProgress,
      failed: false,
      transfer: null,
      detail: envProgress?.message ?? PHASE_LABEL[phase] ?? null,
    };
  } else if (downloading && live) {
    liveLine = {
      label: `Downloading ${model.name}`,
      pct: live.pct,
      indeterminate: live.status === 'starting',
      failed: false,
      transfer: live,
      detail: live.message || null,
    };
  } else if (installing && live) {
    liveLine = {
      label: 'Finishing setup',
      pct: live.pct,
      indeterminate: live.status === 'starting',
      failed: false,
      transfer: null,
      detail: live.message || null,
    };
  } else if (failed) {
    liveLine = {
      label: failed.error ?? 'The last attempt stopped early.',
      pct: failed.pct,
      indeterminate: false,
      failed: true,
      transfer: null,
      detail: null,
    };
  }

  // Install chains every outstanding leg, so there is only ever one verb here.
  let action: ModelState['action'] = null;
  let blocked: string | null = null;

  if (running) {
    action = { kind: 'cancel', label: 'Stop' };
  } else if (uvMissing && !ready) {
    blocked = 'Local Mesh needs one small helper installed first.';
  } else if (failed) {
    action = { kind: 'retry', label: 'Try again' };
  } else if (!ready) {
    // Say the download size when there is one: it is the only cost a person
    // can act on before committing, and it is the question they always ask.
    const remaining = needsFiles && weights !== 'complete' ? model.diskGb : 0;
    action = {
      kind: 'install',
      label: weights === 'partial' ? 'Resume install' : remaining > 0 ? `Install · ${remaining} GB` : 'Install',
    };
  }

  // Another model's chain holds the venv; pressing Install now would queue
  // behind it with no sign of why, so say so instead.
  if (chain && !mine && !ready && !running) {
    action = null;
    blocked = 'Another model is installing. This one can go next.';
  }

  const status: ModelState['status'] = running
    ? { label: onEngine ? 'Setting up' : downloading ? 'Downloading' : 'Installing', variant: 'accent' }
    : failed
      ? { label: 'Stopped early', variant: 'danger' }
      : ready
        ? { label: 'Ready to use', variant: 'success' }
        : weights === 'partial' || stepsDone > 1
          ? { label: 'Part installed', variant: 'warning' }
          : { label: 'Not installed', variant: 'neutral' };

  return {
    steps,
    stepsDone,
    ready,
    running,
    live: liveLine,
    status,
    action,
    blocked,
    fit: fitFor(model, vramTotalBytes),
  };
}
