import fs from 'node:fs';
import path from 'node:path';
import { createDefaultPipeline, summarizePipeline } from '../core/types';
import type { Pipeline, PipelineSummary } from '../core/types';
import { log } from './logger';
import { getPaths } from './paths';
import { getSettings, setSettings } from './settings';

const ID_RE = /^[\w-]+$/;

function pipelineFile(id: string): string {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error(`Invalid pipeline id "${id}".`);
  return path.join(getPaths().pipelines, `${id}.json`);
}

function isPipeline(value: unknown): value is Pipeline {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<Pipeline>;
  return typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.nodes) && Array.isArray(p.edges);
}

export function readPipeline(id: string): Pipeline | null {
  let file: string;
  try {
    file = pipelineFile(id);
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return isPipeline(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function listPipelines(): PipelineSummary[] {
  const dir = getPaths().pipelines;
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const summaries: PipelineSummary[] = [];
  for (const file of files) {
    const p = readPipeline(file.slice(0, -'.json'.length));
    if (p) summaries.push(summarizePipeline(p));
    else log.general.warn(`skipping unreadable pipeline file ${file}`);
  }
  return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function writePipeline(pipeline: Pipeline): boolean {
  if (!isPipeline(pipeline)) throw new Error('Not a pipeline.');
  const file = pipelineFile(pipeline.id);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(pipeline, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
  return true;
}

export function deletePipeline(id: string): boolean {
  const file = pipelineFile(id);
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file);
  if (getSettings().defaultPipelineId === id) setSettings({ defaultPipelineId: null });
  log.general.info(`pipeline ${id} deleted`);
  return true;
}

/** Fresh install: seed the canonical chain so the Generate view has something to run. */
export function ensureDefaultPipeline(): void {
  if (listPipelines().length > 0) return;
  const pipeline = createDefaultPipeline();
  writePipeline(pipeline);
  if (!getSettings().defaultPipelineId) setSettings({ defaultPipelineId: pipeline.id });
  log.general.info(`created default pipeline ${pipeline.id}`);
}
