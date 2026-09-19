import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import readline from 'node:readline';
import type { WorkerCommand, WorkerEvent } from '../core/types';
import { log } from './logger';
import { getRembgDir, getTorchHubDir } from './paths';
import type { ProcessExit } from './proc';

/**
 * One python worker process (resources/python/PROTOCOL.md): JSON-line commands
 * on stdin, JSON-line events on stdout. Emits:
 *   'event' (WorkerEvent)   every parsed stdout line
 *   'exit'  (ProcessExit)   once, when the process is gone
 */

const GRACEFUL_STOP_MS = 5000;
const wlog = log.for('worker', 'generation');

export interface WorkerSpawnOptions {
  python: string;
  scriptsDir: string;
  root: string;
}

export class WorkerProcess extends EventEmitter {
  readonly pid: number | undefined;
  private readonly child: ChildProcess;
  private exitInfo: ProcessExit | null = null;

  constructor(opts: WorkerSpawnOptions) {
    super();
    this.child = spawn(opts.python, ['-u', path.join(opts.scriptsDir, 'worker.py')], {
      cwd: opts.scriptsDir,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        // Nothing may reach the network mid-generation; everything a backend
        // loads is fetched by the weights step (see ModelDefinition.extraRepos).
        HF_HUB_OFFLINE: '1',
        LOCAL_MESH_ROOT: opts.root,
        LOCAL_MESH_HOME: opts.root,
        // rembg's cache dir, pre-seeded during env setup so background removal
        // never has to download the u2netp ONNX from GitHub here.
        U2NET_HOME: getRembgDir(),
        // torch.hub's cache. HF_HUB_OFFLINE does not cover torch.hub, and
        // TRELLIS loads its DINOv2 conditioner from GitHub + Meta's CDN rather
        // than the Hub; the model's postInstall hook seeded this directory, and
        // torch.hub reuses a cached repo without touching the network.
        TORCH_HOME: getTorchHubDir(),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.pid = this.child.pid;

    if (this.child.stdout) {
      readline.createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on('line', (line) => {
        this.onStdout(line);
      });
    }
    if (this.child.stderr) {
      readline.createInterface({ input: this.child.stderr, crlfDelay: Infinity }).on('line', (line) => {
        if (line.trim()) wlog.debug(line);
      });
    }
    // A write that races the worker's exit fails the pipe with EPIPE. An
    // 'error' with no listener is an uncaught exception in the main process, so
    // a python crash at the wrong moment would take the app's error handling
    // with it; the exit path reports the death properly a moment later.
    this.child.stdin?.on('error', (err) => {
      wlog.debug(`worker stdin: ${err.message}`);
    });
    this.child.once('error', (err) => {
      const enoent = (err as NodeJS.ErrnoException).code === 'ENOENT';
      wlog.error(
        enoent
          ? `could not start the python worker: ${opts.python} does not exist. Run Setup in the Models view.`
          : `could not start the python worker: ${err.message}`
      );
      this.finish({ code: null, signal: null });
    });
    this.child.once('close', (code, signal) => this.finish({ code, signal }));
  }

  get alive(): boolean {
    return this.exitInfo === null;
  }

  get exit(): ProcessExit | null {
    return this.exitInfo;
  }

  private onStdout(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as { event?: unknown };
        if (parsed && typeof parsed.event === 'string') {
          this.emit('event', parsed as WorkerEvent);
          return;
        }
      } catch {
        // Not an event after all; log it below.
      }
    }
    wlog.debug(line);
  }

  private finish(info: ProcessExit): void {
    if (this.exitInfo) return;
    this.exitInfo = info;
    this.child.stdin?.end();
    this.emit('exit', info);
  }

  send(cmd: WorkerCommand): void {
    const stdin = this.child.stdin;
    if (!this.alive || !stdin || !stdin.writable) throw new Error('The worker is not running.');
    stdin.write(`${JSON.stringify(cmd)}\n`);
  }

  /** Resolve with the first event matching `pred`; reject on timeout (0 = none) or worker exit. */
  waitFor<T extends WorkerEvent>(pred: (e: WorkerEvent) => e is T, timeoutMs: number, label: string): Promise<T>;
  waitFor(pred: (e: WorkerEvent) => boolean, timeoutMs: number, label: string): Promise<WorkerEvent>;
  waitFor(pred: (e: WorkerEvent) => boolean, timeoutMs: number, label: string): Promise<WorkerEvent> {
    return new Promise((resolve, reject) => {
      if (!this.alive) {
        reject(new Error(`Worker exited before ${label} (code ${this.exitInfo?.code ?? 'unknown'}).`));
        return;
      }
      let timer: NodeJS.Timeout | null = null;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        this.off('event', onEvent);
        this.off('exit', onExit);
      };
      const onEvent = (e: WorkerEvent) => {
        if (!pred(e)) return;
        cleanup();
        resolve(e);
      };
      const onExit = (info: ProcessExit) => {
        cleanup();
        reject(new Error(`Worker exited during ${label} (code ${info.code ?? 'null'}${info.signal ? `, ${info.signal}` : ''}).`));
      };
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          cleanup();
          reject(new Error(`Timed out waiting for ${label} after ${Math.round(timeoutMs / 1000)}s.`));
        }, timeoutMs);
      }
      this.on('event', onEvent);
      this.on('exit', onExit);
    });
  }

  private exited(): Promise<ProcessExit> {
    if (this.exitInfo) return Promise.resolve(this.exitInfo);
    return new Promise((resolve) => this.once('exit', resolve));
  }

  /** Graceful: send `shutdown`, SIGKILL after 5s. Otherwise SIGKILL immediately. */
  async stop(graceful = true): Promise<ProcessExit> {
    if (this.exitInfo) return this.exitInfo;
    const done = this.exited();
    if (graceful) {
      try {
        this.send({ cmd: 'shutdown' });
      } catch {
        // stdin already closed; fall through to the kill below.
      }
      // The timer is cleared on the winning path too: a pending 5s timeout keeps
      // the event loop alive, which would stall the app's own quit by that long.
      let timer: NodeJS.Timeout | undefined;
      const result = await Promise.race([
        done,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), GRACEFUL_STOP_MS);
        }),
      ]);
      if (timer) clearTimeout(timer);
      if (result) return result;
      wlog.warn(`worker did not exit within ${GRACEFUL_STOP_MS / 1000}s of shutdown; killing pid ${this.pid ?? '?'}`);
    }
    this.child.kill('SIGKILL');
    return done;
  }
}
