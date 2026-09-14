import fs from 'node:fs';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { BrowserWindow } from 'electron';
import { IPC_CHANNELS, MODELS, MODEL_BY_ID } from '../core/types';
import type {
  ModelDefinition,
  ModelDownloadProgress,
  ModelDownloadStatus,
  ModelInstallState,
} from '../core/types';
import { envPython, isEnvUsable, readManifest, requireUv, scriptsVersion } from './envManager';
import {
  COMPLETE_MARKER,
  downloadSnapshot,
  isAborted,
  manifestCoversRepos,
  readCompleteManifest,
} from './hfDownload';
import type { SnapshotRepo } from './hfDownload';
import { log } from './logger';
import { getPaths, getReposDir } from './paths';
import { CancelledError, errorMessage, isCancelled, runCapture, spawnLines } from './proc';
import { getState, isBusy, isModelLoaded } from './queueState';

/**
 * Two independent actions per model:
 *   - weights: an HF snapshot pulled straight over HTTPS (no python involved),
 *   - deps: the per-model git clones and pip installs, which need the env.
 * Only one of the two runs at a time for a given model; different models may
 * run concurrently. The renderer follows along over MODELS_DOWNLOAD_PROGRESS.
 */

/** Contains the bundled scripts version the deps were installed for. */
const DEPS_MARKER = '.deps-installed';
const SIZE_TTL_MS = 30_000;

const dlog = log.for('download');

type RunKind = 'weights' | 'deps';

interface ModelRun {
  kind: RunKind;
  /** Weights: aborts the fetch. */
  controller: AbortController | null;
  /** Deps: the git / uv child currently running. */
  child: ChildProcess | null;
  cancelled: boolean;
}

const runs = new Map<string, ModelRun>();
const sizeCache = new Map<string, { at: number; bytes: number }>();

function requireModel(modelId: string): ModelDefinition {
  const model = MODEL_BY_ID[modelId];
  if (!model) throw new Error(`Unknown model "${modelId}".`);
  return model;
}

/** Absolute snapshot directory for a model, whether or not it exists yet. */
export function modelDir(modelId: string): string {
  requireModel(modelId);
  return path.join(getPaths().models, modelId);
}

function dirSize(dir: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += dirSize(full);
    } else if (entry.isFile()) {
      try {
        total += fs.statSync(full).size;
      } catch {
        // Vanished mid-walk.
      }
    }
  }
  return total;
}

function cachedSize(modelId: string, dir: string): number {
  const hit = sizeCache.get(modelId);
  if (hit && Date.now() - hit.at < SIZE_TTL_MS) return hit.bytes;
  const bytes = dirSize(dir);
  sizeCache.set(modelId, { at: Date.now(), bytes });
  return bytes;
}

function invalidateSize(modelId: string): void {
  sizeCache.delete(modelId);
}

function hasAnyFile(dir: string): boolean {
  try {
    return fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

/**
 * Every Hugging Face repo the model's weights step has to fetch: its own
 * snapshot at the root of `models/<id>`, then each extra in its own
 * subdirectory. Empty for backends with no weights at all.
 */
function snapshotRepos(model: ModelDefinition): SnapshotRepo[] {
  if (!model.hfRepo) return [];
  return [
    { repo: model.hfRepo, dir: '', ...(model.hfAllowPatterns ? { allowPatterns: model.hfAllowPatterns } : {}) },
    ...(model.extraRepos ?? []).map((extra) => ({
      repo: extra.repo,
      dir: extra.dir,
      ...(extra.allowPatterns ? { allowPatterns: extra.allowPatterns } : {}),
    })),
  ];
}

function installState(model: ModelDefinition, version: string): ModelInstallState {
  const dir = path.join(getPaths().models, model.id);
  // The mock backend is procedural: nothing to fetch, nothing to install.
  if (model.id === 'mock') {
    return { id: model.id, weights: 'complete', deps: 'installed', sizeBytes: 0, dir, ready: true };
  }
  // A `.complete` written before the model gained an extra repo does not cover
  // it, so the model drops back to `partial` and "Resume download" picks up the
  // missing repo without re-fetching the main snapshot.
  const complete = manifestCoversRepos(readCompleteManifest(dir), snapshotRepos(model));
  const weights = complete ? 'complete' : hasAnyFile(dir) ? 'partial' : 'none';
  let depsVersion: string | null = null;
  try {
    depsVersion = fs.readFileSync(path.join(dir, DEPS_MARKER), 'utf-8').trim();
  } catch {
    depsVersion = null;
  }
  const deps = depsVersion === version ? 'installed' : 'missing';
  return {
    id: model.id,
    weights,
    deps,
    sizeBytes: weights === 'none' ? 0 : cachedSize(model.id, dir),
    dir,
    ready: weights === 'complete' && deps === 'installed',
  };
}

export function listModels(): ModelInstallState[] {
  const version = scriptsVersion();
  return MODELS.map((model) => installState(model, version));
}

export function getModelInstallState(modelId: string): ModelInstallState {
  return installState(requireModel(modelId), scriptsVersion());
}

export function isModelReady(modelId: string): boolean {
  return getModelInstallState(modelId).ready;
}

export function isDownloading(modelId: string): boolean {
  return runs.has(modelId);
}

function emit(event: ModelDownloadProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.MODELS_DOWNLOAD_PROGRESS, event);
  }
}

function progress(
  modelId: string,
  kind: RunKind,
  status: ModelDownloadStatus,
  message: string,
  extra: Partial<ModelDownloadProgress> = {}
): void {
  emit({ modelId, kind, status, pct: 0, downloadedBytes: 0, totalBytes: 0, message, ...extra });
}

/** Claim the single run slot for a model, or explain why it is taken. */
function beginRun(model: ModelDefinition, kind: RunKind): ModelRun {
  const existing = runs.get(model.id);
  if (existing) {
    throw new Error(
      existing.kind === 'weights'
        ? `${model.name} is already downloading.`
        : `${model.name} is already installing its dependencies.`
    );
  }
  const run: ModelRun = {
    kind,
    controller: kind === 'weights' ? new AbortController() : null,
    child: null,
    cancelled: false,
  };
  runs.set(model.id, run);
  return run;
}

// ---------------------------------------------------------------- weights

export async function downloadModel(modelId: string): Promise<void> {
  const model = requireModel(modelId);
  if (model.id === 'mock') {
    progress(modelId, 'weights', 'done', 'Nothing to download', { pct: 100 });
    return;
  }
  const run = beginRun(model, 'weights');
  const dest = path.join(getPaths().models, modelId);
  const repos = snapshotRepos(model);
  try {
    progress(modelId, 'weights', 'starting', `Contacting ${model.hfRepo || 'Hugging Face'}`);
    dlog.info(
      `${modelId}: downloading ${repos.map((r) => r.repo).join(', ') || '(no repo)'} into ${dest}`
    );
    for (const extra of model.extraRepos ?? []) {
      dlog.info(`${modelId}: extra repo ${extra.repo} → ${extra.dir}${extra.note ? ` (${extra.note})` : ''}`);
    }

    if (repos.length === 0) {
      // A backend with no weights of its own: mark it complete and move on.
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(
        path.join(dest, COMPLETE_MARKER),
        `${JSON.stringify({ repo: null, repos: [], files: [] })}\n`
      );
    } else {
      const result = await downloadSnapshot({
        repos,
        dest,
        ...(run.controller ? { signal: run.controller.signal } : {}),
        onProgress: ({ downloadedBytes, totalBytes, file }) => {
          progress(modelId, 'weights', 'downloading', file, {
            downloadedBytes,
            totalBytes,
            pct: totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0,
          });
        },
        onLog: (message) => dlog.info(`${modelId}: ${message}`),
      });
      dlog.info(`${modelId}: weights complete — ${result.files.length} files, ${result.totalBytes} bytes`);
    }
    invalidateSize(modelId);
    progress(modelId, 'weights', 'done', `${model.name} weights downloaded`, { pct: 100 });
  } catch (err) {
    invalidateSize(modelId);
    if (isAborted(err) || isCancelled(err) || run.cancelled) {
      dlog.warn(`${modelId}: download cancelled (partial files kept, it will resume)`);
      progress(modelId, 'weights', 'cancelled', 'Cancelled');
      return;
    }
    const message = errorMessage(err);
    dlog.error(`${modelId}: download failed: ${message}`);
    progress(modelId, 'weights', 'failed', message, { error: message });
    throw new Error(message);
  } finally {
    runs.delete(modelId);
  }
}

// ------------------------------------------------------------------- deps

/** Run one dependency command, forwarding its output as `installing-deps` progress. */
async function runDepsStep(
  model: ModelDefinition,
  run: ModelRun,
  label: string,
  pct: number,
  cmd: string,
  args: string[]
): Promise<void> {
  if (run.cancelled) throw new CancelledError();
  dlog.info(`${model.id}: ${label}: ${cmd} ${args.join(' ')}`);
  progress(model.id, 'deps', 'installing-deps', label, { pct });
  const recent: string[] = [];
  let lines = 0;
  const onLine = (line: string) => {
    if (!line.trim()) return;
    recent.push(line);
    if (recent.length > 8) recent.shift();
    lines += 1;
    dlog.debug(`${model.id}: ${line}`);
    // Creep toward the next checkpoint; pip gives no total to divide by.
    progress(model.id, 'deps', 'installing-deps', line, {
      pct: Math.round(pct + (95 - pct) * (1 - Math.exp(-lines / 40))),
    });
  };
  const proc = spawnLines(cmd, args, { onStdout: onLine, onStderr: onLine });
  run.child = proc.child;
  let code: number | null;
  try {
    ({ code } = await proc.exited);
  } catch (err) {
    run.child = null;
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${cmd} was not found on PATH. Install it and restart Local Mesh.`);
    }
    throw err;
  }
  run.child = null;
  if (run.cancelled) throw new CancelledError();
  if (code !== 0) {
    throw new Error(`${label} failed (exit ${code}).${recent.length ? `\n${recent.join('\n')}` : ''}`);
  }
}

async function requireGit(): Promise<void> {
  try {
    const r = await runCapture('git', ['--version'], { timeoutMs: 5000 });
    if (r.code === 0) return;
  } catch {
    // ENOENT below.
  }
  throw new Error('git was not found. Install git and restart Local Mesh; model backends are cloned from GitHub.');
}

export async function installModelDeps(modelId: string): Promise<void> {
  const model = requireModel(modelId);
  if (model.id === 'mock') {
    progress(modelId, 'deps', 'done', 'No dependencies needed', { pct: 100 });
    return;
  }
  if (!isEnvUsable()) {
    throw new Error(
      'The Python environment is not set up yet. Use "Set up" in the Models view before installing model dependencies.'
    );
  }

  const run = beginRun(model, 'deps');
  const version = scriptsVersion();
  const manifest = readManifest();
  const entry = manifest.models[modelId];
  const dest = path.join(getPaths().models, modelId);
  try {
    fs.mkdirSync(dest, { recursive: true });
    progress(modelId, 'deps', 'installing-deps', `Preparing ${model.name} dependencies`, { pct: 2 });

    if (!entry) {
      dlog.warn(`${modelId}: not in the manifest; nothing to install`);
    } else {
      const scripts = getPaths().scripts;
      const repos = getReposDir();
      fs.mkdirSync(repos, { recursive: true });

      if (entry.repos.some((r) => !fs.existsSync(path.join(repos, r.dir)))) await requireGit();
      for (const repo of entry.repos) {
        const target = path.join(repos, repo.dir);
        if (fs.existsSync(target)) {
          dlog.info(`${modelId}: repo ${repo.dir} already cloned`);
          continue;
        }
        await runDepsStep(model, run, `Cloning ${repo.dir}`, 5, 'git', [
          'clone', '--depth', '1', repo.url, target,
        ]);
      }

      if (entry.requirements) {
        const requirements = path.join(scripts, entry.requirements);
        if (!fs.existsSync(requirements)) {
          throw new Error(`Bundled requirements are missing: ${requirements}`);
        }
        const uv = await requireUv();
        await runDepsStep(model, run, `Installing ${model.name} dependencies`, 10, uv, [
          'pip', 'install', '--python', envPython(), '-r', requirements,
        ]);
      }

      for (const repo of entry.repos) {
        if (!repo.pipInstall) continue;
        const uv = await requireUv();
        await runDepsStep(model, run, `Installing ${repo.dir}`, 60, uv, [
          'pip', 'install', '--python', envPython(), '-e', path.join(repos, repo.dir),
        ]);
      }
    }

    if (run.cancelled) throw new CancelledError();
    fs.writeFileSync(path.join(dest, DEPS_MARKER), `${version}\n`);
    invalidateSize(modelId);
    dlog.info(`${modelId}: dependencies installed for scripts ${version}`);
    progress(modelId, 'deps', 'done', `${model.name} dependencies installed`, { pct: 100 });
  } catch (err) {
    invalidateSize(modelId);
    if (isCancelled(err) || run.cancelled) {
      dlog.warn(`${modelId}: dependency install cancelled`);
      progress(modelId, 'deps', 'cancelled', 'Cancelled');
      return;
    }
    const message = errorMessage(err);
    dlog.error(`${modelId}: dependency install failed: ${message}`);
    progress(modelId, 'deps', 'failed', message, { error: message });
    throw new Error(message);
  } finally {
    runs.delete(modelId);
  }
}

// ----------------------------------------------------------------- cancel

/** Cancels whichever of download / install is running for the model. */
export function cancelModelDownload(modelId: string): void {
  const run = runs.get(modelId);
  if (!run) return;
  run.cancelled = true;
  run.controller?.abort();
  run.child?.kill('SIGTERM');
  dlog.info(`${modelId}: cancel requested (${run.kind})`);
}

/** App quit: stop everything in flight. Partial weights resume next time. */
export function killDownloadChildren(): void {
  for (const modelId of [...runs.keys()]) cancelModelDownload(modelId);
}

function queuedForModel(modelId: string): boolean {
  return getState().jobs.some(
    (j) => j.modelId === modelId && (j.status === 'queued' || j.status === 'loading' || j.status === 'running')
  );
}

export function deleteModel(modelId: string): void {
  const model = requireModel(modelId);
  if (runs.has(modelId)) throw new Error(`${model.name} is busy; cancel that first.`);
  if (isModelLoaded(modelId)) {
    throw new Error(`${model.name} is loaded in the worker; unload it first.`);
  }
  if (isBusy() && queuedForModel(modelId)) {
    throw new Error(`${model.name} still has jobs in the queue.`);
  }
  fs.rmSync(path.join(getPaths().models, modelId), { recursive: true, force: true });
  invalidateSize(modelId);
  dlog.info(`${modelId}: weights and dependency marker removed`);
}
