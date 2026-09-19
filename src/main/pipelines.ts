import fs from 'node:fs';
import path from 'node:path';
import { createDefaultPipeline, migratePipeline, summarizePipeline } from '../core/types';
import type { Pipeline, PipelineSummary } from '../core/types';
import { plural } from './format';
import { log } from './logger';
import { getPaths } from './paths';
import { errorMessage } from './proc';
import { getSettings, setSettings, writeJsonAtomic } from './settings';

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
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    // listPipelines warns once per bad file; the reason belongs here, next to it.
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') log.general.debug(`${id}.json could not be read: ${errorMessage(err)}`);
    return null;
  }
  if (!isPipeline(parsed)) {
    log.general.debug(`${id}.json is not a pipeline (missing id, name, nodes or edges)`);
    return null;
  }
  const migrated = migratePipeline(parsed);
  // Settle the file on the current node vocabulary once, rather than
  // re-deriving the same graph on every read.
  if (migrated !== parsed) {
    try {
      writePipeline(migrated);
      log.general.info(`pipeline "${migrated.name}" migrated to individual mesh op nodes`);
    } catch (err) {
      log.general.warn(
        `pipeline "${migrated.name}" was migrated in memory but could not be saved: ${errorMessage(err)}`
      );
    }
  }
  return migrated;
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
  // The editor autosaves on a debounce, so two saves of the same pipeline can
  // overlap; a shared `.tmp` name would let one truncate the other's staging
  // file and rename the result into place.
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, pipeline);
  // The editor autosaves on a 600ms debounce, so this fires while the user is
  // still dragging nodes around: a timeline event it is not.
  log.general.debug(
    `pipeline "${pipeline.name}" saved (${plural(pipeline.nodes.length, 'node')}, ${plural(pipeline.edges.length, 'edge')})`
  );
  return true;
}

export function deletePipeline(id: string): boolean {
  const file = pipelineFile(id);
  if (!fs.existsSync(file)) return false;
  const name = readPipeline(id)?.name ?? id;
  fs.rmSync(file);
  if (getSettings().defaultPipelineId === id) setSettings({ defaultPipelineId: null });
  log.general.info(`pipeline "${name}" deleted`);
  return true;
}

/** Fresh install: seed the canonical chain so the Generate view has something to run. */
export function ensureDefaultPipeline(): void {
  if (listPipelines().length > 0) return;
  const pipeline = createDefaultPipeline();
  writePipeline(pipeline);
  if (!getSettings().defaultPipelineId) setSettings({ defaultPipelineId: pipeline.id });
  log.general.info(`no pipelines found; created the default "${pipeline.name}"`);
}
