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
  };
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
  const next = sanitizeSettings(patch, getSettings());
  cached = next;
  const file = getSettingsPath();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
  log.general.info(`settings updated: ${Object.keys(patch ?? {}).join(', ') || '(nothing)'}`);
  return { ...next };
}
