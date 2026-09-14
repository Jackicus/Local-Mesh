/**
 * Three log channels, three files in ~/.local-mesh/logs:
 *   general.log    — app lifecycle, IPC, env setup, downloads (main + renderer)
 *   errors.log     — every level=error entry from ANY channel is mirrored here
 *   generation.log — python worker stdout/stderr, job progress, model load/unload
 *
 * The main process keeps an in-memory ring buffer per channel (last 2000
 * entries) for fast reads, pushes each new entry to the renderer over
 * LOGS_ENTRY, and appends to the file. Files rotate at 5MB (one .1 backup).
 */
export type LogChannel = 'general' | 'errors' | 'generation';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogSource = 'main' | 'renderer' | 'worker' | 'env' | 'download';

export interface LogEntry {
  id: number;
  /** ms since epoch */
  ts: number;
  channel: LogChannel;
  level: LogLevel;
  source: LogSource;
  message: string;
  /** Present for generation entries tied to a queued job. */
  jobId?: string;
}

export interface LogReadOptions {
  /** Max entries, newest last. Default 500. */
  limit?: number;
  /** Only entries with id > sinceId (for incremental refresh). */
  sinceId?: number;
}

export const LOG_CHANNELS: LogChannel[] = ['general', 'errors', 'generation'];

export const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

export const LOG_RING_SIZE = 2000;
