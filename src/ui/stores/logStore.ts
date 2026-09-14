import type { LogChannel, LogEntry, LogLevel } from '../../core/types';
import { LOG_RING_SIZE } from '../../core/logs';
import { api, createStore, useStore } from './createStore';

/**
 * Per-channel ring buffers fed by main's LOGS_ENTRY push, seeded with the
 * last entries on bind. Unread counts let the dock show an errors badge.
 */
export interface LogStoreState {
  hydrated: boolean;
  entries: Record<LogChannel, LogEntry[]>;
  /** Errors logged since the Logs view last looked at the errors channel. */
  unseenErrors: number;
}

const store = createStore<LogStoreState>({
  hydrated: false,
  entries: { general: [], errors: [], generation: [] },
  unseenErrors: 0,
});

let bound = false;

function push(list: LogEntry[], entry: LogEntry): LogEntry[] {
  const next = list.length >= LOG_RING_SIZE ? list.slice(list.length - LOG_RING_SIZE + 1) : list.slice();
  next.push(entry);
  return next;
}

export const logStore = {
  ...store,

  bind: () => {
    const electron = api();
    if (bound || !electron) return;
    bound = true;
    electron.onLogEntry((entry) => {
      store.setState((prev) => ({
        entries: { ...prev.entries, [entry.channel]: push(prev.entries[entry.channel], entry) },
        unseenErrors: entry.channel === 'errors' ? prev.unseenErrors + 1 : prev.unseenErrors,
      }));
    });
    Promise.all([
      electron.readLogs('general', { limit: LOG_RING_SIZE }),
      electron.readLogs('errors', { limit: LOG_RING_SIZE }),
      electron.readLogs('generation', { limit: LOG_RING_SIZE }),
    ]).then(([general, errors, generation]) => {
      store.setState((prev) => ({
        hydrated: true,
        // Merge: anything pushed before the read resolved has a higher id.
        entries: {
          general: mergeById(general, prev.entries.general),
          errors: mergeById(errors, prev.entries.errors),
          generation: mergeById(generation, prev.entries.generation),
        },
      }));
    });
  },

  clear: async (channel: LogChannel) => {
    await api()?.clearLogs(channel);
    store.setState((prev) => ({ entries: { ...prev.entries, [channel]: [] } }));
  },

  markErrorsSeen: () => store.setState({ unseenErrors: 0 }),

  /** Renderer-side logging; lands in the files and in every subscriber. */
  write: (level: LogLevel, message: string, channel: LogChannel = 'general') => {
    api()?.log(level, message, channel);
  },
};

function mergeById(seed: LogEntry[], live: LogEntry[]): LogEntry[] {
  if (live.length === 0) return seed.slice(-LOG_RING_SIZE);
  const maxSeed = seed.length ? seed[seed.length - 1]!.id : -1;
  return [...seed, ...live.filter((e) => e.id > maxSeed)].slice(-LOG_RING_SIZE);
}

export function useLogStore(): [LogStoreState, typeof logStore] {
  return [useStore(store), logStore];
}
