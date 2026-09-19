import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';

/** Small child-process helpers shared by env setup, model downloads and the worker. */

export interface ProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface LineProcess {
  child: ChildProcess;
  /** Resolves when stdio has closed; rejects only when the process could not be spawned. */
  exited: Promise<ProcessExit>;
  /**
   * Stop the child *and everything it spawned*, escalating to SIGKILL if the
   * group is still alive after a grace period. Safe to call more than once and
   * after the process has already gone.
   */
  kill: (signal?: NodeJS.Signals) => void;
}

export interface LineProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
}

// Multi-hundred-MB CUDA wheels routinely exceed uv's default 30 s HTTP
// timeout on ordinary home links; every child inherits a generous one.
// Retries cover the transient timeouts that still slip through.
const CHILD_ENV_DEFAULTS: Record<string, string> = {
  UV_HTTP_TIMEOUT: '900',
  UV_HTTP_RETRIES: '5',
};

/**
 * `uv pip install` and `git clone` are wrappers: the work happens in children
 * they spawn (the pip resolver, git-remote-https). Signalling only the direct
 * child leaves those running, still holding the venv, after a "cancelled"
 * operation — so every child gets its own process group and cancellation
 * signals the group. Windows has no process groups to signal; there the kill
 * falls back to the direct child, and `detached` is left off so the child does
 * not get its own console window.
 */
const DETACH = process.platform !== 'win32';

/** How long a group gets to honour SIGTERM before SIGKILL. */
const KILL_GRACE_MS = 5000;

/**
 * Signal the child's whole process group, falling back to the child alone.
 *
 * `process.kill(-pid)` throws ESRCH once the group is gone — including the
 * ordinary case where the child has already been reaped — and an uncaught
 * throw here would take the main process down, so every path is guarded.
 */
function signalTree(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (DETACH) {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // No group (spawn failed, or it is already gone): try the child itself.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // Already reaped.
  }
}

function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  // Already exited: nothing to signal, and -pid may have been recycled.
  if (child.exitCode !== null || child.signalCode !== null) return;
  signalTree(child, signal);
  if (signal === 'SIGKILL') return;
  const escalate = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) signalTree(child, 'SIGKILL');
  }, KILL_GRACE_MS);
  // Never hold the event loop open just to escalate.
  escalate.unref();
  child.once('close', () => clearTimeout(escalate));
  child.once('error', () => clearTimeout(escalate));
}

/** Spawn with piped stdio and deliver stdout/stderr one line at a time. */
export function spawnLines(cmd: string, args: string[], opts: LineProcessOptions = {}): LineProcess {
  const child = spawn(cmd, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...CHILD_ENV_DEFAULTS, ...opts.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    // Own process group, so cancel can take the whole tree. stdio stays piped
    // and the handle stays referenced (no unref), so line streaming and the
    // 'close'/'error' events below are unaffected.
    detached: DETACH,
  });
  const attach = (stream: NodeJS.ReadableStream | null, cb?: (line: string) => void) => {
    if (!stream) return;
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => cb?.(line));
  };
  attach(child.stdout, opts.onStdout);
  attach(child.stderr, opts.onStderr);

  const exited = new Promise<ProcessExit>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  // Mark handled so a spawn failure nobody awaits never surfaces as an unhandled rejection.
  exited.catch(() => {});
  return { child, exited, kill: (signal: NodeJS.Signals = 'SIGTERM') => killTree(child, signal) };
}

export interface CaptureResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Run to completion and collect output; kills the process after `timeoutMs`. */
export function runCapture(
  cmd: string,
  args: string[],
  opts: { timeoutMs: number; cwd?: string; env?: NodeJS.ProcessEnv }
): Promise<CaptureResult> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...CHILD_ENV_DEFAULTS, ...opts.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: DETACH,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      // The group, not just the child: a hung probe may be blocked in a
      // subprocess of its own, and killing only the wrapper would leave it.
      signalTree(child, 'SIGKILL');
    }, opts.timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export class CancelledError extends Error {
  constructor(message = 'Cancelled') {
    super(message);
    this.name = 'CancelledError';
  }
}

export function isCancelled(err: unknown): boolean {
  return err instanceof CancelledError;
}
