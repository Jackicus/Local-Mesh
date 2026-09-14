import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../core/types';
import type { EnvPhase, EnvProgressEvent, EnvStatus } from '../core/types';
import { log } from './logger';
import { getPaths, getRembgDir } from './paths';
import { CancelledError, errorMessage, isCancelled, runCapture, spawnLines } from './proc';
import type { ChildProcess } from 'node:child_process';

/**
 * The uv-managed Python environment: venv creation, torch + base deps and a
 * cached import probe. One setup at a time. The python scripts themselves are
 * bundled with the app (getPaths().scripts) and never installed.
 */

interface DetectedGpu {
  name: string;
  computeCap: number;
}

/** nvidia-smi is the only thing that answers before torch exists; absent = no NVIDIA GPU. */
async function detectGpu(): Promise<DetectedGpu | null> {
  try {
    const r = await runCapture('nvidia-smi', ['--query-gpu=compute_cap,name', '--format=csv,noheader'], { timeoutMs: 8000 });
    const line = r.stdout.trim().split('\n')[0] ?? '';
    const [cap, ...rest] = line.split(',');
    const computeCap = Number.parseFloat((cap ?? '').trim());
    if (!Number.isFinite(computeCap)) return null;
    return { name: rest.join(',').trim() || 'NVIDIA GPU', computeCap };
  } catch {
    return null;
  }
}

export function pickTorchVariant(variants: TorchVariant[], gpu: DetectedGpu | null): TorchVariant {
  for (const v of variants) {
    if (v.noGpu) {
      if (!gpu) return v;
      continue;
    }
    if (v.maxComputeCap !== undefined) {
      if (gpu && gpu.computeCap <= v.maxComputeCap) return v;
      continue;
    }
    if (gpu) return v;
  }
  return variants[variants.length - 1]!;
}

export interface ManifestRepo {
  url: string;
  dir: string;
  pipInstall: boolean;
  /**
   * Where the importable package sits inside the clone, when it is not the
   * clone root. Hunyuan3D-2.1 keeps `hy3dshape` one level down, so the worker
   * puts `<repos>/<dir>/<subdir>` on sys.path instead of `<repos>/<dir>`.
   */
  subdir?: string;
  /** Clone with `--recurse-submodules` (TRELLIS vendors FlexiCubes that way). */
  submodules?: boolean;
}
export interface ManifestModel {
  requirements: string | null;
  repos: ManifestRepo[];
  /**
   * Python snippets run as `<env>/bin/python -c "<snippet>"` after pip
   * succeeds, in order. Used for anything a model needs on disk that is neither
   * a Hugging Face snapshot nor a pip package — TRELLIS pre-seeds its DINOv2
   * conditioner through torch.hub here. A failing snippet fails the install.
   */
  postInstall?: string[];
}
/** One torch build; the first variant whose conditions match the machine wins. */
export interface TorchVariant {
  name: string;
  /** Only when the GPU's compute capability is at or below this (e.g. 6.9 = pre-Volta). */
  maxComputeCap?: number;
  /** Only when no NVIDIA GPU is detected. */
  noGpu?: boolean;
  packages: string[];
  /** null = PyPI default (bundles the current CUDA; supports the newest GPUs). */
  indexUrl: string | null;
}

export interface Manifest {
  version: string;
  python: string;
  torch: { variants: TorchVariant[] };
  baseRequirements: string;
  models: Record<string, ManifestModel>;
}

// Mirrors resources/python/manifest.json; used when the file is absent (dev before the python side lands).
const FALLBACK_MANIFEST: Manifest = {
  version: '0.2.0',
  python: '3.11',
  torch: {
    variants: [
      { name: 'pre-volta-cu126', maxComputeCap: 6.9, packages: ['torch==2.9.1', 'torchvision'], indexUrl: 'https://download.pytorch.org/whl/cu126' },
      { name: 'cpu', noGpu: true, packages: ['torch', 'torchvision'], indexUrl: 'https://download.pytorch.org/whl/cpu' },
      { name: 'cuda-current', packages: ['torch', 'torchvision'], indexUrl: null },
    ],
  },
  baseRequirements: 'requirements/base.txt',
  models: {
    'hunyuan3d-2mini': {
      requirements: 'requirements/hunyuan3d.txt',
      repos: [{ url: 'https://github.com/Tencent-Hunyuan/Hunyuan3D-2.git', dir: 'Hunyuan3D-2', pipInstall: true }],
    },
    triposr: {
      requirements: 'requirements/triposr.txt',
      repos: [{ url: 'https://github.com/VAST-AI-Research/TripoSR.git', dir: 'TripoSR', pipInstall: false }],
    },
    triposg: {
      requirements: 'requirements/triposg.txt',
      repos: [{ url: 'https://github.com/VAST-AI-Research/TripoSG.git', dir: 'TripoSG', pipInstall: false }],
    },
    'hunyuan3d-2': {
      requirements: 'requirements/hunyuan3d.txt',
      repos: [{ url: 'https://github.com/Tencent-Hunyuan/Hunyuan3D-2.git', dir: 'Hunyuan3D-2', pipInstall: false }],
    },
    'hunyuan3d-2.1': {
      requirements: 'requirements/hunyuan3d21.txt',
      repos: [
        {
          url: 'https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1.git',
          dir: 'Hunyuan3D-2.1',
          subdir: 'hy3dshape',
          pipInstall: false,
        },
      ],
    },
    'step1x-3d': {
      requirements: 'requirements/step1x3d.txt',
      repos: [{ url: 'https://github.com/stepfun-ai/Step1X-3D.git', dir: 'Step1X-3D', pipInstall: false }],
    },
    trellis: {
      requirements: 'requirements/trellis.txt',
      repos: [{ url: 'https://github.com/microsoft/TRELLIS.git', dir: 'TRELLIS', submodules: true, pipInstall: false }],
      postInstall: [
        "import torch; torch.hub.load('facebookresearch/dinov2', 'dinov2_vitl14_reg', pretrained=True, trust_repo=True)",
      ],
    },
    mock: { requirements: null, repos: [] },
  },
};

const PROBE_TTL_MS = 60_000;
const PROBE_SCRIPT = [
  'import json,sys',
  'd={"python":sys.version.split()[0],"torch":None,"torchvision":None,"cuda":False,"gpu":None,"vram":None,"error":None}',
  'try:',
  '  import torch',
  '  d["torch"]=torch.__version__',
  '  d["cuda"]=bool(torch.cuda.is_available())',
  '  if d["cuda"]:',
  '    d["gpu"]=torch.cuda.get_device_name(0)',
  '    d["vram"]=int(torch.cuda.get_device_properties(0).total_memory)',
  'except Exception as e:',
  '  d["error"]=str(e)',
  // Separate try: a broken torchvision must not hide a working torch.
  'try:',
  '  import torchvision',
  '  d["torchvision"]=torchvision.__version__',
  'except Exception:',
  '  pass',
  'print(json.dumps(d))',
].join('\n');

interface ProbeResult {
  python: string;
  torch: string | null;
  torchvision: string | null;
  cuda: boolean;
  gpu: string | null;
  vram: number | null;
  error: string | null;
}

interface SetupRun {
  child: ChildProcess | null;
  cancelled: boolean;
}

const elog = log.for('env');
let setupRun: SetupRun | null = null;
let currentPhase: EnvPhase = 'idle';
let lastError: string | null = null;
let probeCache: { at: number; result: ProbeResult | null } | null = null;
let probeInFlight: Promise<ProbeResult | null> | null = null;
let uvPathCache: string | null = null;

/** The bundled resources/python directory the worker and requirements are read from. */
export function bundledPythonDir(): string {
  return getPaths().scripts;
}

export function readManifest(): Manifest {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(bundledPythonDir(), 'manifest.json'), 'utf-8')) as Partial<Manifest>;
    return {
      version: raw.version ?? FALLBACK_MANIFEST.version,
      python: raw.python ?? FALLBACK_MANIFEST.python,
      torch: raw.torch ?? FALLBACK_MANIFEST.torch,
      baseRequirements: raw.baseRequirements ?? FALLBACK_MANIFEST.baseRequirements,
      models: raw.models ?? FALLBACK_MANIFEST.models,
    };
  } catch {
    return FALLBACK_MANIFEST;
  }
}

export function envPython(): string {
  const env = getPaths().env;
  return process.platform === 'win32' ? path.join(env, 'Scripts', 'python.exe') : path.join(env, 'bin', 'python');
}

export function envExists(): boolean {
  return fs.existsSync(envPython());
}

/** Cheap synchronous check used before spawning anything from the env. */
export function isEnvUsable(): boolean {
  return envExists();
}

/** Version of the bundled python scripts; deps markers are keyed on it. */
export function scriptsVersion(): string {
  try {
    const v = fs.readFileSync(path.join(bundledPythonDir(), 'VERSION'), 'utf-8').trim();
    if (v) return v;
  } catch {
    // Fall back to the manifest (whose own fallback is 0.1.0).
  }
  return readManifest().version;
}

// Electron launched from a desktop entry often lacks the shell's PATH additions.
const UV_CANDIDATES = [
  path.join(os.homedir(), '.local', 'bin', 'uv'),
  path.join(os.homedir(), '.cargo', 'bin', 'uv'),
  '/usr/local/bin/uv',
  '/usr/bin/uv',
];

export async function findUv(): Promise<{ path: string; version: string } | null> {
  const candidates = uvPathCache ? [uvPathCache] : ['uv', ...UV_CANDIDATES];
  for (const candidate of candidates) {
    try {
      const r = await runCapture(candidate, ['--version'], { timeoutMs: 5000 });
      if (r.code === 0) {
        uvPathCache = candidate;
        return { path: candidate, version: r.stdout.trim().replace(/^uv\s+/, '') };
      }
    } catch {
      // ENOENT: try the next location.
    }
  }
  uvPathCache = null;
  return null;
}

export async function requireUv(): Promise<string> {
  const uv = await findUv();
  if (!uv) throw new Error('uv was not found. Install it from https://docs.astral.sh/uv/ and restart Local Mesh.');
  return uv.path;
}

export function invalidateProbe(): void {
  probeCache = null;
}

async function probeEnv(): Promise<ProbeResult | null> {
  if (!envExists()) return null;
  if (probeCache && Date.now() - probeCache.at < PROBE_TTL_MS) return probeCache.result;
  if (probeInFlight) return probeInFlight;
  probeInFlight = (async () => {
    let result: ProbeResult | null = null;
    try {
      const r = await runCapture(envPython(), ['-c', PROBE_SCRIPT], { timeoutMs: 60_000 });
      const line = r.stdout.trim().split('\n').pop() ?? '';
      if (r.code === 0 && line.startsWith('{')) result = JSON.parse(line) as ProbeResult;
      else elog.warn(`env probe failed (exit ${r.code}${r.timedOut ? ', timed out' : ''}): ${r.stderr.trim().slice(-400)}`);
    } catch (err) {
      elog.warn(`env probe could not run: ${errorMessage(err)}`);
    }
    probeCache = { at: Date.now(), result };
    probeInFlight = null;
    return result;
  })();
  return probeInFlight;
}

/**
 * The torch build currently in the environment, as PEP 440 requirement
 * specifiers. Local version segments are stripped on purpose: the installed
 * wheel is `2.9.1+cu126`, which is not a version any index can resolve, while
 * `torch==2.9.1` matches it (PEP 440: a specifier with no local segment matches
 * any local version) *and* exists on PyPI for the resolver to check against.
 *
 * Returns an empty array when torch is not importable, which callers treat as
 * "refuse to install model dependencies".
 */
export async function torchConstraintSpecifiers(): Promise<string[]> {
  const probe = await probeEnv();
  if (!probe?.torch) return [];
  const base = (version: string): string => version.split('+')[0] ?? version;
  const specifiers = [`torch==${base(probe.torch)}`];
  if (probe.torchvision) specifiers.push(`torchvision==${base(probe.torchvision)}`);
  return specifiers;
}

/** Background-removal model the worker asks rembg for (worker.py's default). */
const REMBG_MODEL = 'u2netp';
const REMBG_PREFETCH_TIMEOUT_MS = 10 * 60_000;

/**
 * Download rembg's ONNX model now, while setup is the thing the user is
 * watching. The worker runs offline and calls `new_session` in the middle of
 * the first generation, where a 5 MB GitHub fetch reads as a stall (or fails
 * outright). Best effort: a miss here only costs that first job its stall, so
 * it is logged as a warning and never fails setup.
 */
async function prefetchRembgModel(): Promise<void> {
  const home = getRembgDir();
  fs.mkdirSync(home, { recursive: true });
  const script = `from rembg import new_session; new_session(${JSON.stringify(REMBG_MODEL)})`;
  try {
    const r = await runCapture(envPython(), ['-c', script], {
      timeoutMs: REMBG_PREFETCH_TIMEOUT_MS,
      env: { U2NET_HOME: home },
    });
    if (r.code === 0) {
      elog.info(`rembg ${REMBG_MODEL} model ready in ${home}`);
      return;
    }
    elog.warn(
      `could not pre-fetch the rembg ${REMBG_MODEL} model (exit ${r.code}${r.timedOut ? ', timed out' : ''}); ` +
        `the first generation will download it: ${r.stderr.trim().slice(-400)}`
    );
  } catch (err) {
    elog.warn(`could not pre-fetch the rembg ${REMBG_MODEL} model: ${errorMessage(err)}`);
  }
}

export async function getEnvStatus(): Promise<EnvStatus> {
  const uv = await findUv();
  const exists = envExists();
  const probe = exists ? await probeEnv() : null;
  return {
    uvAvailable: uv !== null,
    uvVersion: uv?.version ?? null,
    envExists: exists,
    scriptsVersion: scriptsVersion(),
    pythonVersion: probe?.python ?? null,
    torchVersion: probe?.torch ?? null,
    cudaAvailable: probe ? probe.cuda : null,
    gpuName: probe?.gpu ?? null,
    vramTotalBytes: probe?.vram ?? null,
    ready: exists && Boolean(probe?.torch),
    phase: currentPhase,
    lastError,
  };
}

function emit(event: EnvProgressEvent): void {
  currentPhase = event.phase;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.ENV_PROGRESS, event);
  }
}

/** Best-effort progress inside a phase: creeps from `start` toward `end` as lines arrive. */
function creep(start: number, end: number, lines: number): number {
  return Math.round(start + (end - start) * (1 - Math.exp(-lines / 40)));
}

/** Run one setup step, streaming every line as progress and to the log. */
async function runStep(
  run: SetupRun,
  phase: EnvPhase,
  range: [number, number],
  message: string,
  cmd: string,
  args: string[]
): Promise<void> {
  if (run.cancelled) throw new CancelledError();
  emit({ phase, pct: range[0], message });
  elog.info(`${message}: ${cmd} ${args.join(' ')}`);
  let lines = 0;
  const recent: string[] = [];
  const onLine = (line: string) => {
    if (!line.trim()) return;
    lines += 1;
    recent.push(line);
    if (recent.length > 6) recent.shift();
    elog.debug(line);
    emit({ phase, pct: creep(range[0], range[1], lines), message, line });
  };
  const proc = spawnLines(cmd, args, { onStdout: onLine, onStderr: onLine });
  run.child = proc.child;
  const { code } = await proc.exited;
  run.child = null;
  if (run.cancelled) throw new CancelledError();
  if (code !== 0) {
    throw new Error(`${message} failed (exit ${code}).${recent.length ? `\n${recent.join('\n')}` : ''}`);
  }
}

export async function setupEnv(): Promise<void> {
  if (setupRun) throw new Error('Environment setup is already running.');
  const run: SetupRun = { child: null, cancelled: false };
  setupRun = run;
  lastError = null;
  const paths = getPaths();
  const manifest = readManifest();
  const python = envPython();
  const bundled = bundledPythonDir();
  try {
    emit({ phase: 'checking', pct: 0, message: 'Looking for uv' });
    const uv = await requireUv();
    if (!fs.existsSync(path.join(bundled, manifest.baseRequirements))) {
      throw new Error(`Bundled requirements are missing: ${path.join(bundled, manifest.baseRequirements)}`);
    }

    if (envExists()) {
      emit({ phase: 'creating-venv', pct: 5, message: 'Reusing existing virtualenv' });
      elog.info(`venv already present at ${paths.env}`);
    } else {
      // A leftover dir without a python binary would make uv ask whether to overwrite.
      fs.rmSync(paths.env, { recursive: true, force: true });
      await runStep(run, 'creating-venv', [2, 8], `Creating virtualenv (python ${manifest.python})`, uv, [
        'venv', paths.env, '--python', manifest.python,
      ]);
    }

    const gpu = await detectGpu();
    const variant = pickTorchVariant(manifest.torch.variants, gpu);
    elog.info(
      `torch variant "${variant.name}" for ${gpu ? `${gpu.name} (compute ${gpu.computeCap})` : 'no NVIDIA GPU'}`
    );
    await runStep(run, 'installing-torch', [8, 70], `Installing PyTorch (${variant.name})`, uv, [
      'pip', 'install', '--python', python, ...variant.packages,
      ...(variant.indexUrl ? ['--index-url', variant.indexUrl] : []),
    ]);
    await runStep(run, 'installing-base', [70, 94], 'Installing worker dependencies', uv, [
      'pip', 'install', '--python', python, '-r', path.join(bundled, manifest.baseRequirements),
    ]);

    if (run.cancelled) throw new CancelledError();
    emit({ phase: 'verifying', pct: 95, message: 'Verifying torch import' });
    invalidateProbe();
    const probe = await probeEnv();
    if (run.cancelled) throw new CancelledError();
    if (!probe) throw new Error('The environment probe did not run; see the general log.');
    if (!probe.torch) throw new Error(`torch failed to import: ${probe.error ?? 'unknown error'}`);

    emit({ phase: 'verifying', pct: 97, message: 'Fetching the background-removal model' });
    await prefetchRembgModel();
    if (run.cancelled) throw new CancelledError();

    elog.info(
      `environment ready: python ${probe.python}, torch ${probe.torch}, cuda ${probe.cuda}${probe.gpu ? ` (${probe.gpu})` : ''}`
    );
    emit({ phase: 'done', pct: 100, message: 'Environment ready' });
  } catch (err) {
    if (isCancelled(err) || run.cancelled) {
      elog.warn('environment setup cancelled');
      emit({ phase: 'cancelled', pct: 0, message: 'Setup cancelled' });
      return;
    }
    lastError = errorMessage(err);
    elog.error(`environment setup failed: ${lastError}`);
    emit({ phase: 'failed', pct: 0, message: lastError });
    throw new Error(lastError);
  } finally {
    setupRun = null;
    invalidateProbe();
    // Back to idle for status polls; the terminal phase was already broadcast.
    currentPhase = 'idle';
  }
}

export function cancelEnvSetup(): void {
  if (!setupRun) return;
  setupRun.cancelled = true;
  setupRun.child?.kill('SIGTERM');
}

/** Kill any in-flight setup child (app quit). */
export function killEnvChildren(): void {
  cancelEnvSetup();
}

export function removeEnv(): void {
  if (setupRun) throw new Error('Cannot remove the environment while setup is running.');
  const paths = getPaths();
  fs.rmSync(paths.env, { recursive: true, force: true });
  // Per-model deps live in the venv, so their markers are stale now.
  try {
    for (const entry of fs.readdirSync(paths.models)) {
      fs.rmSync(path.join(paths.models, entry, '.deps-installed'), { force: true });
    }
  } catch {
    // No models dir yet.
  }
  invalidateProbe();
  lastError = null;
  elog.info('environment removed (env/, model dependency markers)');
}
