import type { ExportFormat, GenerationJobSpec, MeshOp } from './generation';
import { normalizeMeshOp } from './generation';
import { defaultModelSettings, getModel } from './models';

/**
 * A job is the unit of work the Generate view is built around: one image, one
 * model (or one pipeline), a list of mesh edits to run after it, and a name for
 * what comes out. Everything about it stays editable until it runs.
 *
 * This replaces the old shape, where the Generate view could only hand main a
 * pipeline id plus a pile of image paths and main compiled a frozen
 * GenerationJobSpec on the spot. That made a queued job unchangeable: the only
 * way to alter one was to cancel it and queue a fresh one in its place. Here
 * the draft is the thing that is stored, reordered and edited, and the spec is
 * compiled from it at the moment the job actually starts.
 *
 * Pure data and pure functions: main, preload and the renderer all import this.
 */

/**
 * What a job runs. A model directly, which is what almost everyone wants, or a
 * saved pipeline for anyone who has turned the node editor on. The two are
 * alternatives in the same slot rather than one wrapping the other — the
 * Generate view swaps one picker for the other, and nothing else changes.
 */
export type JobSource =
  | {
      kind: 'model';
      modelId: string;
      /** Keys come from ModelDefinition.settings; a missing key falls back to its default. */
      settings: Record<string, number | string | boolean>;
      removeBackground: boolean;
    }
  | { kind: 'pipeline'; pipelineId: string };

/**
 * One mesh edit attached to a job, with an identity of its own: the same op can
 * appear more than once in a chain and the list is drag-reorderable, so the
 * position in the array cannot be the key.
 */
export interface JobModifier {
  id: string;
  op: MeshOp;
}

/** Everything about a job the user can change. */
export interface JobDraft {
  source: JobSource;
  /** Absolute path the user chose. Null while the job is still empty. */
  imagePath: string | null;
  /**
   * Output stem, without extension. Empty means "follow the image", which is
   * what a job does until someone types over it.
   */
  name: string;
  /** Mesh edits run after generation, in this order. */
  modifiers: JobModifier[];
  format: ExportFormat;
}

/**
 * One state of a job's mesh, kept in its cache directory. `revisions[0]` is
 * what the model produced; every entry after it is one edit applied to the one
 * before. Back and forward walk this list; Save copies the current entry into
 * the outputs folder and the whole job — cache included — goes away.
 */
export interface JobRevision {
  /** Absolute path under cache/<jobId>/. */
  path: string;
  /** The edit that produced this revision; null for the generated mesh. */
  op: MeshOp | null;
  vertices: number;
  faces: number;
  createdAt: number;
}

/**
 * 'draft' is a job sitting in the queue that nobody has started yet — the state
 * every job is born in. Start promotes every runnable draft to 'queued' and the
 * pump works down the list from there.
 */
export type JobStatus =
  | 'draft'
  | 'queued'
  | 'loading'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled';

export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ['done', 'failed', 'cancelled'];

export function isTerminalStatus(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}

/** A job the user is still assembling or has queued but not started. */
export function isPending(status: JobStatus): boolean {
  return status === 'draft' || status === 'queued';
}

export function isActive(status: JobStatus): boolean {
  return status === 'loading' || status === 'running';
}

// ---------------------------------------------------------------------------
// Defaults and normalisation
// ---------------------------------------------------------------------------

let modifierCounter = 0;

export function newModifierId(): string {
  modifierCounter += 1;
  return `mod-${Date.now().toString(36)}-${modifierCounter.toString(36)}`;
}

export function makeModifier(op: MeshOp): JobModifier {
  return { id: newModifierId(), op };
}

/** A job source pointing at `modelId`, with that model's own defaults filled in. */
export function modelSource(modelId: string): JobSource {
  const model = getModel(modelId);
  return {
    kind: 'model',
    modelId,
    settings: model ? defaultModelSettings(model) : {},
    // Photographs are the common case and a model reads leftover background as
    // geometry, so this is on unless someone turns it off.
    removeBackground: true,
  };
}

export function emptyDraft(modelId: string | null): JobDraft {
  return {
    source: modelId ? modelSource(modelId) : { kind: 'model', modelId: '', settings: {}, removeBackground: true },
    imagePath: null,
    name: '',
    modifiers: [],
    format: 'glb',
  };
}

/** The file stem of an image path, which is also a job's default name. */
export function imageStem(imagePath: string): string {
  const base = imagePath.split(/[\\/]/).pop() ?? imagePath;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/** Filesystem-safe, bounded, never empty. Shared by the compiler and the UI. */
export function slugName(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[^\w.-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64) || 'mesh'
  );
}

/**
 * What a job is called. An explicit name wins; otherwise the image's own stem,
 * which is what "cat.png becomes cat.glb" means. A job with neither is new and
 * says so.
 */
export function jobTitle(draft: JobDraft): string {
  if (draft.name.trim()) return draft.name.trim();
  if (draft.imagePath) return imageStem(draft.imagePath);
  return 'New job';
}

/** The output stem, slugged. Never 'New job' — an unnamed job follows its image. */
export function jobStem(draft: JobDraft): string {
  if (draft.name.trim()) return slugName(draft.name);
  if (draft.imagePath) return slugName(imageStem(draft.imagePath));
  return 'mesh';
}

/** Coerce stored or IPC JSON into a draft, falling back rather than throwing. */
export function normalizeDraft(raw: unknown, fallbackModelId: string | null = null): JobDraft {
  const value = (raw ?? {}) as Partial<JobDraft>;
  const base = emptyDraft(fallbackModelId);
  const source = normalizeSource(value.source, fallbackModelId);
  const modifiers = Array.isArray(value.modifiers)
    ? value.modifiers.flatMap((entry): JobModifier[] => {
        const m = (entry ?? {}) as Partial<JobModifier>;
        try {
          return [{ id: typeof m.id === 'string' && m.id ? m.id : newModifierId(), op: normalizeMeshOp(m.op) }];
        } catch {
          // A modifier that no longer normalises (an op removed from the
          // vocabulary) is dropped rather than failing the whole job.
          return [];
        }
      })
    : base.modifiers;
  const format = (['glb', 'obj', 'stl', 'ply'] as ExportFormat[]).includes(value.format as ExportFormat)
    ? (value.format as ExportFormat)
    : base.format;
  return {
    source,
    imagePath: typeof value.imagePath === 'string' && value.imagePath ? value.imagePath : null,
    name: typeof value.name === 'string' ? value.name : '',
    modifiers,
    format,
  };
}

function normalizeSource(raw: unknown, fallbackModelId: string | null): JobSource {
  const value = (raw ?? {}) as Partial<Extract<JobSource, { kind: 'model' }>> &
    Partial<Extract<JobSource, { kind: 'pipeline' }>>;
  if (value.kind === 'pipeline' && typeof value.pipelineId === 'string' && value.pipelineId) {
    return { kind: 'pipeline', pipelineId: value.pipelineId };
  }
  const modelId = typeof value.modelId === 'string' && value.modelId ? value.modelId : (fallbackModelId ?? '');
  const model = getModel(modelId);
  return {
    kind: 'model',
    modelId,
    settings: {
      ...(model ? defaultModelSettings(model) : {}),
      ...((value.settings ?? {}) as Record<string, number | string | boolean>),
    },
    removeBackground: value.removeBackground !== false,
  };
}

// ---------------------------------------------------------------------------
// Can it run?
// ---------------------------------------------------------------------------

export interface JobBlocker {
  /** Short reason, written for the queue row. */
  message: string;
  /** Which part of the row the user has to fix. */
  field: 'model' | 'pipeline' | 'image';
}

/**
 * Why this draft cannot start, or null when it can. Both processes run it: the
 * row greys its Start affordance on it, and main refuses to queue on it — so a
 * job can never reach the worker half-built.
 *
 * `installedModelIds` is passed in rather than read from a store, because main
 * and the renderer learn what is installed from different places.
 */
export function jobBlocker(
  draft: JobDraft,
  installedModelIds: ReadonlySet<string>,
  knownPipelineIds?: ReadonlySet<string>
): JobBlocker | null {
  if (draft.source.kind === 'pipeline') {
    if (!draft.source.pipelineId) return { message: 'Choose a pipeline', field: 'pipeline' };
    if (knownPipelineIds && !knownPipelineIds.has(draft.source.pipelineId)) {
      return { message: 'That pipeline is gone', field: 'pipeline' };
    }
  } else {
    if (!draft.source.modelId) return { message: 'Choose a model', field: 'model' };
    if (!getModel(draft.source.modelId)) return { message: 'That model is gone', field: 'model' };
    if (!installedModelIds.has(draft.source.modelId)) {
      return { message: 'That model is not installed yet', field: 'model' };
    }
  }
  if (!draft.imagePath) return { message: 'Add an image', field: 'image' };
  return null;
}

// ---------------------------------------------------------------------------
// Compilation
// ---------------------------------------------------------------------------

export interface JobCompileContext {
  jobId: string;
  /** Absolute path of the job's own copy of the image, under inputs/<jobId>/. */
  imagePath: string;
  /** Absolute directory the mesh is written to: this job's cache dir, not outputs/. */
  outputDir: string;
  /** Resolved seed; main picks one when the setting says -1. */
  seed: number;
}

/**
 * Fold a model-sourced draft into a worker job. A pipeline-sourced draft is
 * compiled by compilePipeline() in main, which can read the graph, and then
 * runs through withModifiers() to pick up any edits stacked on top of it.
 */
export function compileModelJob(draft: JobDraft, ctx: JobCompileContext): GenerationJobSpec {
  if (draft.source.kind !== 'model') {
    throw new Error('compileModelJob was given a pipeline job.');
  }
  const model = getModel(draft.source.modelId);
  if (!model) throw new Error(`Unknown model "${draft.source.modelId}".`);
  const settings: Record<string, number | string | boolean> = {
    ...defaultModelSettings(model),
    ...draft.source.settings,
  };
  if ('seed' in settings || model.settings.some((s) => s.key === 'seed')) settings['seed'] = ctx.seed;

  return {
    jobId: ctx.jobId,
    modelId: model.id,
    imagePath: ctx.imagePath,
    removeBackground: draft.source.removeBackground,
    settings,
    postProcess: draft.modifiers.map((m) => m.op),
    export: { format: draft.format, outputDir: ctx.outputDir, baseName: jobStem(draft) },
  };
}

/**
 * Stack a draft's modifiers onto an already-compiled spec, and point it at the
 * job's cache directory under the job's own name. Used for pipeline jobs: the
 * graph's own op nodes run first, then whatever the user added on the row.
 */
export function withModifiers(spec: GenerationJobSpec, draft: JobDraft, ctx: JobCompileContext): GenerationJobSpec {
  return {
    ...spec,
    jobId: ctx.jobId,
    imagePath: ctx.imagePath,
    postProcess: [...spec.postProcess, ...draft.modifiers.map((m) => m.op)],
    export: { ...spec.export, format: draft.format, outputDir: ctx.outputDir, baseName: jobStem(draft) },
  };
}
