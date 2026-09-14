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
