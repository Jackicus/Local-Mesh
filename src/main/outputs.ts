import fs from 'node:fs';
import path from 'node:path';
import type { ExportFormat, OutputItem } from '../core/types';
import { formatBytes } from './format';
import { log } from './logger';
import { getPaths, isInside } from './paths';
import { getState, jobModelId } from './jobStore';

const FORMATS: ExportFormat[] = ['glb', 'obj', 'stl', 'ply'];

function formatOf(file: string): ExportFormat | null {
  const ext = path.extname(file).slice(1).toLowerCase() as ExportFormat;
  return FORMATS.includes(ext) ? ext : null;
}

export function listOutputs(): OutputItem[] {
  const dir = getPaths().outputs;
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  // Attribute files to the job that saved them. A saved job leaves the queue
  // immediately, so this is usually empty — the attribution only survives for
  // as long as the save is still being processed, which is enough for the push
  // that follows it.
  const byOutput = new Map<string, { jobId: string; modelId?: string }>();
  for (const job of getState().jobs) {
    if (!job.savedPath) continue;
    const modelId = jobModelId(job);
    byOutput.set(path.resolve(job.savedPath), { jobId: job.id, ...(modelId ? { modelId } : {}) });
  }
  const items: OutputItem[] = [];
  for (const name of names) {
    const format = formatOf(name);
    if (!format) continue;
    const file = path.join(dir, name);
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile()) continue;
      const origin = byOutput.get(path.resolve(file));
      items.push({
        path: file,
        name,
        format,
        sizeBytes: stat.size,
        createdAt: Math.min(stat.birthtimeMs || stat.mtimeMs, stat.mtimeMs),
        ...(origin ? { jobId: origin.jobId, modelId: origin.modelId } : {}),
      });
    } catch {
      // Vanished between readdir and stat.
    }
  }
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

export function deleteOutput(file: string): boolean {
  if (typeof file !== 'string' || !isInside(getPaths().outputs, file)) {
    throw new Error('Only files inside the outputs folder can be deleted.');
  }
  if (!fs.existsSync(file)) return false;
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {
    // Vanished between the check and the stat; the message just loses its size.
  }
  fs.rmSync(file);
  log.general.info(`output deleted: ${path.basename(file)}${size ? ` (${formatBytes(size)})` : ''}`);
  return true;
}
