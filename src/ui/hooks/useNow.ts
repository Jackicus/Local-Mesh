import { useCallback, useSyncExternalStore } from 'react';

/**
 * A clock every consumer of the same interval shares, so elapsed readouts tick
 * in lockstep instead of drifting apart. The timer exists only while something
 * is subscribed — mount a component that calls this only while it needs to tick.
 */
interface Ticker {
  now: number;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setInterval> | null;
}

const tickers = new Map<number, Ticker>();

function getTicker(intervalMs: number): Ticker {
  let ticker = tickers.get(intervalMs);
  if (!ticker) {
    ticker = { now: Date.now(), listeners: new Set(), timer: null };
    tickers.set(intervalMs, ticker);
  }
  return ticker;
}

function subscribeTo(intervalMs: number, listener: () => void): () => void {
  const ticker = getTicker(intervalMs);
  ticker.listeners.add(listener);
  if (ticker.timer === null) {
    ticker.now = Date.now();
    ticker.timer = setInterval(() => {
      ticker.now = Date.now();
      ticker.listeners.forEach((l) => l());
    }, intervalMs);
  }
  return () => {
    ticker.listeners.delete(listener);
    if (ticker.listeners.size === 0 && ticker.timer !== null) {
      clearInterval(ticker.timer);
      ticker.timer = null;
    }
  };
}

/** `Date.now()`, re-read every `intervalMs` for as long as this hook is mounted. */
export function useNow(intervalMs = 500): number {
  const subscribe = useCallback(
    (listener: () => void) => subscribeTo(intervalMs, listener),
    [intervalMs]
  );
  const snapshot = useCallback(() => getTicker(intervalMs).now, [intervalMs]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
