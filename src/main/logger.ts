import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import { IPC_CHANNELS, LOG_CHANNELS, LOG_LEVELS, LOG_RING_SIZE } from '../core/types';
import type { LogChannel, LogEntry, LogLevel, LogReadOptions, LogSource } from '../core/types';

/**
 * Three channels, three files in ~/.local-mesh/logs (see core/logs.ts). Every
 * entry goes to an in-memory ring, the channel file, and every open window.
 * Level=error entries from any channel are mirrored into `errors` as a second
 * entry so errors.log is a complete, self-contained record.
 */

const MAX_FILE_BYTES = 5 * 1024 * 1024;
/**
 * Lines are batched for this long before they reach the disk. A chatty backend
 * (tqdm, pip, a python traceback per frame) can emit hundreds of lines a second,
 * and one synchronous append per line blocks the main process — i.e. the UI —
 * on the filesystem. One async append per batch instead; the batch is flushed
 * synchronously on exit so nothing is lost when the app quits.
 */
const FLUSH_INTERVAL_MS = 200;
/** How much of each file is parsed back into the ring at startup. */
const TAIL_BYTES = 512 * 1024;
const LINE_RE = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z) (DEBUG|INFO|WARN|ERROR)\s+\[(\w+)\](?: \(([^)\s]+)\))? ?(.*)$/;
/**
 * Continuation lines of a multi-line message are indented on disk, so a python
 * traceback frame can never be mistaken for a new entry by `LINE_RE` (or by a
 * human grepping the file). The indent is stripped again on read-back.
 */
const CONTINUATION_INDENT = '  ';
/** Longest message kept whole; a traceback or a pip dump is trimmed to this. */
const MAX_MESSAGE_CHARS = 4000;
const TRIM_HEAD = 1200;
const TRIM_TAIL = MAX_MESSAGE_CHARS - TRIM_HEAD;
/** CSI escape sequences: uv, pip and tqdm all colour their output. */
const ANSI_RE = new RegExp('\\u001b\\[[0-9;?]*[ -/]*[@-~]', 'g');

const buffers: Record<LogChannel, LogEntry[]> = { general: [], errors: [], generation: [] };
const fileSizes: Record<LogChannel, number> = { general: 0, errors: 0, generation: 0 };
let logsDir: string | null = null;
let nextId = 1;
const echoToConsole = Boolean(process.env['VITE_DEV_SERVER_URL']);

export interface LogInput {
  channel: LogChannel;
  level: LogLevel;
  source: LogSource;
  message: string;
  jobId?: string;
}

function filePath(channel: LogChannel): string {
  return path.join(logsDir ?? '', `${channel}.log`);
}

/** A line rewritten in place by a progress bar: only its final state is worth keeping. */
function lastSegment(line: string): string {
  if (!line.includes('\r')) return line.trimEnd();
  const parts = line.split('\r').map((p) => p.trimEnd()).filter((p) => p !== '');
  return parts[parts.length - 1] ?? '';
}

/**
 * Everything a message picks up on its way in: colour codes from uv/pip, the
 * carriage returns tqdm redraws with, and the sheer length of a traceback or a
 * failed pip resolve. Trimming keeps the head (what failed) and the tail (why),
 * which is where the answer always is.
 */
function normalize(raw: string): string {
  let text = raw.replace(ANSI_RE, '').split('\n').map(lastSegment).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length > MAX_MESSAGE_CHARS) {
    const dropped = text.length - MAX_MESSAGE_CHARS;
    text = `${text.slice(0, TRIM_HEAD)}\n… ${dropped} characters trimmed …\n${text.slice(-TRIM_TAIL)}`;
  }
  return text;
}

function format(entry: LogEntry): string {
  const job = entry.jobId ? ` (${entry.jobId})` : '';
  const message = entry.message.split('\n').join(`\n${CONTINUATION_INDENT}`);
  return `${new Date(entry.ts).toISOString()} ${entry.level.toUpperCase().padEnd(5)} [${entry.source}]${job} ${message}\n`;
}

function parseTail(channel: LogChannel): LogEntry[] {
  const file = filePath(channel);
  let text: string;
  try {
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, 'r');
    try {
      const start = Math.max(0, size - TAIL_BYTES);
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      text = buf.toString('utf-8');
      // Drop the first (possibly partial) line when we didn't start at the top.
      if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }
  const entries: LogEntry[] = [];
  for (const line of text.split('\n')) {
    const m = LINE_RE.exec(line);
    if (m) {
      const level = m[2]!.toLowerCase() as LogLevel;
      entries.push({
        id: 0,
        ts: Date.parse(m[1]!),
        channel,
        level: LOG_LEVELS.includes(level) ? level : 'info',
        source: m[3] as LogSource,
        message: m[5] ?? '',
        ...(m[4] ? { jobId: m[4] } : {}),
      });
    } else if (entries.length && line) {
      // Continuation of a multi-line message (tracebacks); `format` indented it.
      const continued = line.startsWith(CONTINUATION_INDENT) ? line.slice(CONTINUATION_INDENT.length) : line;
      entries[entries.length - 1]!.message += `\n${continued}`;
    }
  }
  return entries.slice(-LOG_RING_SIZE);
}

/** Point the logger at the logs directory and pre-fill the rings from the files' tails. */
export function initLogger(dir: string): void {
  logsDir = dir;
  fs.mkdirSync(dir, { recursive: true });
  for (const channel of LOG_CHANNELS) {
    const entries = parseTail(channel);
    for (const entry of entries) entry.id = nextId++;
    buffers[channel] = entries;
    try {
      fileSizes[channel] = fs.statSync(filePath(channel)).size;
    } catch {
      fileSizes[channel] = 0;
    }
  }
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    // Whatever is still buffered when the app goes away is the tail of the log
    // that explains why — the one part nobody can afford to lose.
    process.on('exit', () => flushPending(true));
  }
}

const pending: Record<LogChannel, string[]> = { general: [], errors: [], generation: [] };
/** Channels with an append in flight; their lines wait for the next flush so writes stay ordered. */
const writing: Record<LogChannel, boolean> = { general: false, errors: false, generation: false };
let flushTimer: NodeJS.Timeout | null = null;
let exitHookInstalled = false;

function rotateIfNeeded(channel: LogChannel, incoming: number): void {
  if (fileSizes[channel] + incoming <= MAX_FILE_BYTES) return;
  const file = filePath(channel);
  try {
    fs.renameSync(file, `${file}.1`);
  } catch {
    // Nothing to rotate yet.
  }
  fileSizes[channel] = 0;
}

/** Write out everything buffered. `sync` is for process exit, where a callback never runs. */
function flushPending(sync = false): void {
  if (!logsDir) return;
  for (const channel of LOG_CHANNELS) {
    const lines = pending[channel];
    if (!lines.length) continue;
    if (writing[channel] && !sync) continue;
    const text = lines.join('');
    lines.length = 0;
    const bytes = Buffer.byteLength(text);
    rotateIfNeeded(channel, bytes);
    fileSizes[channel] += bytes;
    const file = filePath(channel);
    if (sync) {
      try {
        fs.appendFileSync(file, text);
      } catch {
        // A full disk must never take the app down with it.
      }
      continue;
    }
    writing[channel] = true;
    fs.appendFile(file, text, () => {
      writing[channel] = false;
      // Lines that arrived mid-write are still queued; make sure they land.
      if (pending[channel].length) scheduleFlush();
    });
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushPending();
  }, FLUSH_INTERVAL_MS);
  // Never hold the event loop — and so the app — open for a log line.
  flushTimer.unref?.();
}

function appendToFile(channel: LogChannel, line: string): void {
  if (!logsDir) return;
  pending[channel].push(line);
  scheduleFlush();
}

function push(entry: LogEntry): void {
  const ring = buffers[entry.channel];
  ring.push(entry);
  if (ring.length > LOG_RING_SIZE) ring.splice(0, ring.length - LOG_RING_SIZE);
  appendToFile(entry.channel, format(entry));
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.LOGS_ENTRY, entry);
  }
  if (echoToConsole && entry.level !== 'debug' && entry.channel !== 'errors') {
    const out = entry.level === 'error' || entry.level === 'warn' ? console.error : console.log;
    out(`[${entry.channel}/${entry.source}] ${entry.level}: ${entry.message}`);
  }
}

/** Record one entry (plus its mirror in `errors` when level is error). Returns the primary entry. */
export function write(input: LogInput): LogEntry {
  const message = normalize(typeof input.message === 'string' ? input.message : String(input.message));
  const entry: LogEntry = {
    id: nextId++,
    ts: Date.now(),
    channel: input.channel,
    level: input.level,
    source: input.source,
    message,
    ...(input.jobId ? { jobId: input.jobId } : {}),
  };
  push(entry);
  if (entry.level === 'error' && entry.channel !== 'errors') {
    push({ ...entry, id: nextId++, channel: 'errors' });
  }
  return entry;
}

export function readLogs(channel: LogChannel, options: LogReadOptions = {}): LogEntry[] {
  const ring = buffers[channel];
  if (!ring) throw new Error(`Unknown log channel "${channel}".`);
  const limit = Math.max(1, Math.min(LOG_RING_SIZE, options.limit ?? 500));
  const since = options.sinceId ?? -1;
  const filtered = since >= 0 ? ring.filter((e) => e.id > since) : ring;
  return filtered.slice(-limit);
}

export function clearLogs(channel: LogChannel): void {
  if (!buffers[channel]) throw new Error(`Unknown log channel "${channel}".`);
  buffers[channel] = [];
  fileSizes[channel] = 0;
  // Anything still buffered belongs to the log the user just cleared.
  pending[channel].length = 0;
  if (!logsDir) return;
  try {
    fs.truncateSync(filePath(channel));
  } catch {
    // Missing file: nothing to clear.
  }
  try {
    fs.rmSync(`${filePath(channel)}.1`, { force: true });
  } catch {
    // A rotated file we may not remove is not worth failing the clear over.
  }
}

export interface ChannelLog {
  debug: (message: string, jobId?: string) => void;
  info: (message: string, jobId?: string) => void;
  warn: (message: string, jobId?: string) => void;
  error: (message: string, jobId?: string) => void;
}

function channelLog(channel: LogChannel, source: LogSource): ChannelLog {
  const at =
    (level: LogLevel) =>
    (message: string, jobId?: string): void => {
      write({ channel, level, source, message, ...(jobId ? { jobId } : {}) });
    };
  return { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
}

/**
 * One failure, one error line. A long operation (env setup, a download, mesh
 * processing) logs its own failure with the context only it has — the model id,
 * the request id, the tail of pip's output — and then rethrows. Marking the
 * error here lets the generic IPC wrapper it unwinds through stay quiet instead
 * of writing a second, poorer line for the same event.
 */
const REPORTED = Symbol.for('localMesh.logger.reported');

/** Tag an error as already logged, then throw it. Purely a logging marker. */
export function reported<T>(err: T): T {
  if (err instanceof Error) {
    Object.defineProperty(err, REPORTED, { value: true, enumerable: false, configurable: true });
  }
  return err;
}

export function wasReported(err: unknown): boolean {
  return err instanceof Error && (err as unknown as Record<symbol, unknown>)[REPORTED] === true;
}

export const log = {
  /** App lifecycle, IPC, settings — source 'main'. */
  general: channelLog('general', 'main'),
  /** Queue and worker lifecycle — source 'main'. */
  generation: channelLog('generation', 'main'),
  /** A logger tagged with another source (env setup, downloads, worker output). */
  for: (source: LogSource, channel: LogChannel = 'general'): ChannelLog => channelLog(channel, source),
  write,
};

export function installCrashLogging(): void {
  process.on('uncaughtException', (err) => {
    log.general.error(`uncaught exception in the main process: ${err.stack ?? err}`);
  });
  process.on('unhandledRejection', (reason) => {
    log.general.error(
      `unhandled promise rejection in the main process: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`
    );
  });
}
