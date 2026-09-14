/** Small formatting helpers shared by the Generate view's overlays and lists. */

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** Gigabytes with one decimal, for the VRAM readouts ("5.3"). */
export function formatGb(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  return (bytes / 1024 ** 3).toFixed(1);
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s - m * 60);
  return `${m}m ${rest.toString().padStart(2, '0')}s`;
}

/**
 * Stopwatch voice: "42s" under a minute, "5:29" above it. Used for both the
 * live tick and the final figure so a job's timing never changes shape when
 * it finishes.
 */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.floor(ms / 1000);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  return `${m}:${(total % 60).toString().padStart(2, '0')}`;
}

/** "Sep 13, 14:02" — enough to tell outputs apart without a full timestamp. */
export function formatWhen(ts: number): string {
  const d = new Date(ts);
  const day = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day}, ${time}`;
}

export function fileExtension(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return m ? m[1]!.toLowerCase() : '';
}

export function fileBaseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function formatCount(n: number): string {
  return n.toLocaleString();
}
