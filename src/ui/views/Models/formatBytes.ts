const GB = 1024 ** 3;

/** "1.2 GB", "540 MB", "0 B" — one decimal above the MB mark. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${i >= 2 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

/** Bytes to gigabytes with one decimal, e.g. "8.0 GB". */
export function formatGb(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '?';
  return `${(bytes / GB).toFixed(1)} GB`;
}

export function gbToBytes(gb: number): number {
  return gb * GB;
}

/** "12 MB/s" — a transfer rate in bytes per second. */
export function formatRate(bytesPerSecond: number | null): string | null {
  if (bytesPerSecond == null || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return null;
  return `${formatBytes(bytesPerSecond)}/s`;
}

/**
 * A rough remaining time in words: "about 6 min left". Deliberately coarse —
 * a download that swings between 2 and 30 MB/s cannot promise seconds.
 */
export function formatEta(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0 || seconds > 24 * 3600) return null;
  if (seconds < 90) return 'less than a minute left';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min left`;
  const hours = Math.round(seconds / 360) / 10;
  return `about ${hours} h left`;
}
