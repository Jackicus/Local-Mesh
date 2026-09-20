/**
 * What a model needs before it runs, and the things to press about it.
 *
 * A model only runs when three independent things are true:
 *
 *   1. engine — the Python environment exists (shared by every model)
 *   2. files  — this model's weights are on disk (plain download, needs no env)
 *   3. extras — this model's Python packages are installed into the engine
 *
 * Those three used to be one chained button, because nobody installing an app
 * wants to know it has a venv. But one button hid a real difference: the
 * weights are a plain download that works on a machine with no Python at all,
 * while the engine and the packages are one thing wearing two hats — the
 * packages *cannot* be installed without the engine, and the engine is shared,
 * so only one model may be building it at a time.
 *
 * So this derives TWO actions, matching the two things a person can actually
 * reason about: **model files** (fetch the weights) and **setup** (engine plus
 * this model's packages). Each gets its own button and its own live line, so a
 * download and an install can run at once and each reports where it is. The
 * per-step detail survives as `steps`, which only the expanded panel renders.
 */
import type {
  EnvProgressEvent,
  ModelDefinition,
  ModelDownloadProgress,
  ModelInstallState,
} from '../../../core/types';
import type { InstallChain } from '../../stores/modelStore';
import { ACTION_LABEL, PHASE_LABEL, STEP_HELP } from './copy';
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
 * The live line for one half of the install. Both halves use the same shape so
 * they render through the same component in the same place; only the weights
 * download has a `transfer` to say bytes, rate and ETA about.
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

/** What pressing one of the two buttons does. */
export type ActionKind = 'install' | 'cancel' | 'retry';

export interface ModelAction {
  kind: ActionKind;
  label: string;
}

export interface ModelState {
  steps: InstallStep[];
  stepsDone: number;
  /** True when every outstanding half is satisfied and the model can run. */
  ready: boolean;
  /** Either half of this model's install is in flight. */
  running: boolean;
  /** The weights download: fetch it, stop it, or try again. Null when done. */
  filesAction: ModelAction | null;
  /** The engine plus this model's packages, as one action. Null when done. */
  runtimeAction: ModelAction | null;
  /** Live line for the weights download, or the failure that just happened. */
  filesLive: LiveInstall | null;
  /** Live line for the engine/packages leg, or its failure. */
  runtimeLive: LiveInstall | null;
  /** The badge on the collapsed row. */
  status: { label: string; variant: 'success' | 'accent' | 'warning' | 'danger' | 'neutral' };
  /**
   * Why the setup half cannot start: the one prerequisite the app genuinely
   * cannot install for you (uv), or another model already holding the engine.
   * Never set for the weights half — a download contends with nothing.
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
  /** The setup run holding the engine right now, for any model. */
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
  // The engine and the packages are one action because they are one thing: the
  // packages go *into* the engine. A model with no packages of its own asks for
  // neither — the test shape is pure Python and rides on whatever is there.
  const needsRuntime = model.requirements !== null;
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

  const filesDone = !needsFiles || weights === 'complete';
  const runtimeDone = !needsRuntime || (envReady && deps === 'installed');
  const filesRunning = Boolean(downloading);
  const runtimeRunning = Boolean(installing) || onEngine;
  const filesFailed = failed?.kind === 'weights' ? failed : undefined;
  const runtimeFailed = failed?.kind === 'deps' ? failed : undefined;

  // Files first, because that is the order the buttons sit in and the order a
  // person reads them: get the thing, then make it runnable.
  const steps: InstallStep[] = [];

  if (needsFiles) {
    steps.push({
      key: 'files',
      label: 'Model files',
      status: filesDone ? 'done' : downloading ? 'running' : filesFailed ? 'failed' : 'todo',
      state: filesDone
        ? 'Downloaded'
        : downloading
          ? 'Downloading…'
          : filesFailed
            ? weights === 'partial'
              ? 'Download failed — part of it is on disk'
              : 'Download failed'
            : weights === 'partial'
              ? 'Part downloaded'
              : `${model.diskGb} GB to download`,
      help: STEP_HELP.files,
    });
  }

  if (needsRuntime) {
    steps.push({
      key: 'engine',
      label: 'Shared setup',
      status: envReady ? 'done' : envBusy || onEngine ? 'running' : 'todo',
      state: envReady ? 'Installed' : envBusy || onEngine ? 'Installing…' : 'Not installed',
      help: STEP_HELP.engine,
    });
    steps.push({
      key: 'extras',
      label: 'Finishing touches',
      status:
        deps === 'installed'
          ? 'done'
          : installing
            ? 'running'
            : runtimeFailed
              ? 'failed'
              : envReady
                ? 'todo'
                : 'blocked',
      state:
        deps === 'installed'
          ? 'Installed'
          : installing
            ? 'Installing…'
            : runtimeFailed
              ? 'Install failed'
              : envReady
                ? 'Not installed'
                : 'Waiting for the shared setup',
      help: STEP_HELP.extras,
    });
  }

  const stepsDone = steps.filter((s) => s.status === 'done').length;
  const ready = filesDone && runtimeDone;
  const running = filesRunning || runtimeRunning;

  // Two lines, in two places, because two things can be moving at once: the
  // weights come over HTTPS while the engine is being built, and a single
  // merged line would have to pick one and lie about the other.
  let filesLive: LiveInstall | null = null;
  if (downloading && live) {
    filesLive = {
      label: `Downloading ${model.name}`,
      pct: live.pct,
      indeterminate: live.status === 'starting',
      failed: false,
      transfer: live,
      detail: live.message || null,
    };
  } else if (filesFailed) {
    filesLive = {
      label: filesFailed.error ?? 'The download stopped early.',
      pct: filesFailed.pct,
      indeterminate: false,
      failed: true,
      transfer: null,
      detail: null,
    };
  }

  // The engine leg is the long one and the one nobody expects, so it says out
  // loud that it happens once and every model shares it.
  let runtimeLive: LiveInstall | null = null;
  if (onEngine) {
    const phase = envProgress?.phase ?? 'checking';
    runtimeLive = {
      label: 'Setting up — this part happens once, and every model shares it',
      pct: envProgress?.pct ?? 0,
      indeterminate: !envProgress,
      failed: false,
      transfer: null,
      detail: envProgress?.message ?? PHASE_LABEL[phase] ?? null,
    };
  } else if (installing && live) {
    runtimeLive = {
      label: `Setting up ${model.name}`,
      pct: live.pct,
      indeterminate: live.status === 'starting',
      failed: false,
      transfer: null,
      detail: live.message || null,
    };
  } else if (runtimeFailed) {
    runtimeLive = {
      label: runtimeFailed.error ?? 'Setup stopped early.',
      pct: runtimeFailed.pct,
      indeterminate: false,
      failed: true,
      transfer: null,
      detail: null,
    };
  }

  // The weights half answers to nobody: no engine, no uv, no queue behind
  // another model. The only reason it has no button is that it is finished.
  let filesAction: ModelAction | null = null;
  if (filesRunning) {
    filesAction = { kind: 'cancel', label: ACTION_LABEL.stop };
  } else if (filesFailed) {
    filesAction = { kind: 'retry', label: ACTION_LABEL.retry };
  } else if (!filesDone) {
    // Say the download size: it is the only cost a person can act on before
    // committing, and it is the question they always ask.
    filesAction = {
      kind: 'install',
      label: weights === 'partial' ? ACTION_LABEL.resumeFiles : ACTION_LABEL.getFiles(model.diskGb),
    };
  }

  let runtimeAction: ModelAction | null = null;
  let blocked: string | null = null;
  if (runtimeRunning) {
    runtimeAction = { kind: 'cancel', label: ACTION_LABEL.stop };
  } else if (!runtimeDone && uvMissing) {
    blocked = 'Local Mesh needs one small helper installed first.';
  } else if (!runtimeDone && chain && !mine) {
    // Another model is writing to the shared engine; pressing Set up now would
    // queue behind it with no sign of why, so say so instead.
    blocked = 'Another model is setting up. This one can go next.';
  } else if (runtimeFailed) {
    runtimeAction = { kind: 'retry', label: ACTION_LABEL.retrySetup };
  } else if (!runtimeDone) {
    runtimeAction = { kind: 'install', label: ACTION_LABEL.setUp };
  }

  const status: ModelState['status'] = running
    ? { label: onEngine ? 'Setting up' : downloading ? 'Downloading' : 'Installing', variant: 'accent' }
    : failed
      ? { label: 'Stopped early', variant: 'danger' }
      : ready
        ? { label: 'Ready to use', variant: 'success' }
        : filesDone || runtimeDone || weights === 'partial'
          ? { label: 'Part installed', variant: 'warning' }
          : { label: 'Not installed', variant: 'neutral' };

  return {
    steps,
    stepsDone,
    ready,
    running,
    filesAction,
    runtimeAction,
    filesLive,
    runtimeLive,
    status,
    blocked,
    fit: fitFor(model, vramTotalBytes),
  };
}
