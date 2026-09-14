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

/** Spawn with piped stdio and deliver stdout/stderr one line at a time. */
export function spawnLines(cmd: string, args: string[], opts: LineProcessOptions = {}): LineProcess {
  const child = spawn(cmd, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...CHILD_ENV_DEFAULTS, ...opts.env },
    stdio: ['pipe', 'pipe', 'pipe'],
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
  return { child, exited };
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
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
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
