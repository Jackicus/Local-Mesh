/**
 * The three-step install state machine, derived once and shared by every
 * surface in this view.
 *
 * A model only runs when three independent things are true, and they are the
 * single biggest source of confusion in this app:
 *
 *   1. engine — the Python environment exists (shared by every model)
 *   2. files  — this model's weights are on disk (plain download, needs no env)
 *   3. extras — this model's Python packages are installed into the engine
 *
 * Order matters only for *presentation*: files can be fetched before the engine
 * exists, so the "next thing to do" never sends someone to the engine while
 * there is a download they could be starting instead.
 */
import type { ModelDefinition, ModelDownloadProgress, ModelInstallState } from '../../../core/types';
import { STEP_HELP } from './copy';
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

/** What pressing the one primary button does. */
export type ActionKind = 'download' | 'extras' | 'cancel';

export interface ModelState {
  steps: InstallStep[];
  stepsDone: number;
  /** True when all three are satisfied and the model can actually run. */
  ready: boolean;
  /** A download or a dependency install is in flight for this model. */
  running: boolean;
  /** Live progress for whichever step is running, or the failure that just happened. */
  progress: ModelDownloadProgress | null;
  /** The badge on the collapsed row. */
  status: { label: string; variant: 'success' | 'accent' | 'warning' | 'danger' | 'neutral' };
  /** The single next thing to do, or null when there is nothing or it is blocked. */
  action: { kind: ActionKind; label: string } | null;
  /** Why there is no action, plus the fix it offers. */
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
      detail: `${needs}. Set up the Python engine and Local Mesh can tell you whether your card has it.`,
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
  vramTotalBytes: number | null;
}

export function deriveModelState({
  model,
  install,
  download,
  envReady,
  envBusy,
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

  const steps: InstallStep[] = [];

  steps.push({
    key: 'engine',
    label: 'Python engine',
    status: envReady ? 'done' : envBusy ? 'running' : 'todo',
    state: envReady ? 'Installed' : envBusy ? 'Installing…' : 'Not installed',
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
      label: 'Extra packages',
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
                : 'Waiting for the engine',
      help: STEP_HELP.extras,
    });
  }

  const stepsDone = steps.filter((s) => s.status === 'done').length;
  const ready = stepsDone === steps.length;

  let action: ModelState['action'] = null;
  let blocked: string | null = null;

  if (live) {
    action = { kind: 'cancel', label: 'Stop' };
  } else if (failed && failed.kind === 'deps' && !envReady) {
    // Offering "Try again" here would fail the same way every time: the engine
    // the packages go into is gone. Send the user at the engine instead.
    blocked = `${model.name} needs the Python engine before its extra packages can go in.`;
  } else if (failed) {
    action = { kind: failed.kind === 'deps' ? 'extras' : 'download', label: 'Try again' };
  } else if (needsFiles && weights !== 'complete') {
    // Weights come straight from Hugging Face, so this never waits on the engine.
    action =
      weights === 'partial'
        ? { kind: 'download', label: 'Resume download' }
        : { kind: 'download', label: `Download ${model.diskGb} GB` };
  } else if (needsExtras && deps !== 'installed') {
    if (envReady) action = { kind: 'extras', label: 'Install extra packages' };
    else blocked = `${model.name} needs the Python engine before its extra packages can go in.`;
  } else if (!envReady) {
    blocked = `${model.name} needs the Python engine before it can run.`;
  }

  const status: ModelState['status'] = live
    ? { label: downloading ? 'Downloading' : 'Installing', variant: 'accent' }
    : failed
      ? { label: 'Failed', variant: 'danger' }
      : ready
        ? { label: 'Ready to use', variant: 'success' }
        : steps.length === 1
          ? { label: 'Needs the engine', variant: 'warning' }
          : stepsDone > 0
            ? { label: `${stepsDone} of ${steps.length} done`, variant: 'warning' }
            : { label: 'Not installed', variant: 'neutral' };

  return {
    steps,
    stepsDone,
    ready,
    running: Boolean(live),
    progress: live ?? failed ?? null,
    status,
    action,
    blocked,
    fit: fitFor(model, vramTotalBytes),
  };
}
