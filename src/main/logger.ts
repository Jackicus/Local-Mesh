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
/** How much of each file is parsed back into the ring at startup. */
const TAIL_BYTES = 512 * 1024;
const LINE_RE = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z) (DEBUG|INFO|WARN|ERROR)\s+\[(\w+)\](?: \(([^)\s]+)\))? ?(.*)$/;

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

function format(entry: LogEntry): string {
  const job = entry.jobId ? ` (${entry.jobId})` : '';
  return `${new Date(entry.ts).toISOString()} ${entry.level.toUpperCase().padEnd(5)} [${entry.source}]${job} ${entry.message}\n`;
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
      // Continuation of a multi-line message (tracebacks).
      entries[entries.length - 1]!.message += `\n${line}`;
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
}

function appendToFile(channel: LogChannel, line: string): void {
  if (!logsDir) return;
  const bytes = Buffer.byteLength(line);
  const file = filePath(channel);
  try {
    if (fileSizes[channel] + bytes > MAX_FILE_BYTES) {
      fs.renameSync(file, `${file}.1`);
      fileSizes[channel] = 0;
    }
  } catch {
    // Nothing to rotate yet.
  }
  try {
    fs.appendFileSync(file, line);
    fileSizes[channel] += bytes;
  } catch {
    // A full disk must never take the app down with it.
  }
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
  const message = typeof input.message === 'string' ? input.message : String(input.message);
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
  if (!logsDir) return;
  try {
    fs.truncateSync(filePath(channel));
  } catch {
    // Missing file: nothing to clear.
  }
  fs.rmSync(`${filePath(channel)}.1`, { force: true });
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
    log.general.error(`uncaughtException: ${err.stack ?? err}`);
  });
  process.on('unhandledRejection', (reason) => {
    log.general.error(`unhandledRejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`);
  });
}
