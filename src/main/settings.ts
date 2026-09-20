import fs from 'node:fs';
import { DEFAULT_SETTINGS } from '../core/types';
import type { AppSettings, DevicePreference, PrecisionPreference } from '../core/types';
import { log } from './logger';
import { getSettingsPath } from './paths';

const DEVICES: DevicePreference[] = ['auto', 'cuda', 'cpu'];
const PRECISIONS: PrecisionPreference[] = ['auto', 'fp16', 'fp32'];
/** One day; also keeps setTimeout well inside its 32-bit millisecond limit. */
const MAX_IDLE_MINUTES = 1440;

let cached: AppSettings | null = null;

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function pickEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === 'string' && (allowed as string[]).includes(value) ? (value as T) : fallback;
}

/** Merge an untrusted object over the defaults, coercing every field into range. */
export function sanitizeSettings(raw: unknown, base: AppSettings = DEFAULT_SETTINGS): AppSettings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof AppSettings, unknown>>;
  const has = (key: keyof AppSettings) => key in src;
  return {
    idleUnloadMinutes: has('idleUnloadMinutes')
      ? clampInt(src.idleUnloadMinutes, base.idleUnloadMinutes, 0, MAX_IDLE_MINUTES)
      : base.idleUnloadMinutes,
    stopWorkerWhenIdle: has('stopWorkerWhenIdle') ? Boolean(src.stopWorkerWhenIdle) : base.stopWorkerWhenIdle,
    device: has('device') ? pickEnum(src.device, DEVICES, base.device) : base.device,
    precision: has('precision') ? pickEnum(src.precision, PRECISIONS, base.precision) : base.precision,
    lowVram: has('lowVram') ? Boolean(src.lowVram) : base.lowVram,
    defaultPipelineId: has('defaultPipelineId')
      ? typeof src.defaultPipelineId === 'string' && src.defaultPipelineId
        ? src.defaultPipelineId
        : null
      : base.defaultPipelineId,
    defaultModelId: has('defaultModelId')
      ? typeof src.defaultModelId === 'string' && src.defaultModelId
        ? src.defaultModelId
        : null
      : base.defaultModelId,
  };
}

/**
 * Write JSON where a crash can only ever leave the old file or the new one.
 * The rename is the atomic part, but only once the bytes are actually on the
 * platter: without the fsync, a power loss just after a rename can leave a
 * zero-length settings.json behind on ext4/btrfs. The temp name carries a
 * unique suffix so two writers cannot truncate each other's staging file.
 *
 * Shared with pipelines.ts, the other place that persists user JSON.
 */
export function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  try {
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

function load(): AppSettings {
  try {
    const text = fs.readFileSync(getSettingsPath(), 'utf-8');
    return sanitizeSettings(JSON.parse(text));
  } catch (err) {
    if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) {
      log.general.warn(`settings.json unreadable, using defaults: ${err instanceof Error ? err.message : err}`);
    }
    return { ...DEFAULT_SETTINGS };
  }
}

export function getSettings(): AppSettings {
  if (!cached) cached = load();
  return { ...cached };
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const previous = getSettings();
  const next = sanitizeSettings(patch, previous);
  // Cache only what reached disk: a failed write that had already updated the
  // cache would leave the app running on settings the next launch cannot see.
  writeJsonAtomic(getSettingsPath(), next);
  cached = next;
  // The values matter, not the keys: device, precision and low-VRAM change how
  // the next generation runs, so the timeline has to show what they became.
  const changed = (Object.keys(next) as (keyof AppSettings)[])
    .filter((key) => next[key] !== previous[key])
    .map((key) => `${key} ${String(previous[key])} → ${String(next[key])}`);
  if (changed.length) log.general.info(`settings changed: ${changed.join(', ')}`);
  else log.general.debug('settings saved with no change');
  return { ...next };
}
