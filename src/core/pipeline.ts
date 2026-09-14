import type { ExportFormat, GenerationJobSpec, PostProcessSpec } from './generation';
import { defaultModelSettings, getModel, MODELS } from './models';

/**
 * A pipeline is a small node graph the Generate view runs against one or more
 * images. Ports are typed ('image' | 'mesh'); an edge connects an output port
 * to an input port of the same type. Node `data` is a flat JSON object whose
 * shape is defined per node type below.
 *
 * The canonical chain is:
 *   image-input → (background-removal) → mesh-generator → (post-process) → mesh-export
 * Optional nodes are pass-throughs when absent. compilePipeline() walks the
 * graph and folds it into a GenerationJobSpec for the python worker.
 */
export type PortType = 'image' | 'mesh';

export type NodeType =
  | 'image-input'
  | 'background-removal'
  | 'mesh-generator'
  | 'post-process'
  | 'mesh-export';

export interface PortDefinition {
  id: string;
  label: string;
  type: PortType;
}

export interface NodeDefinition {
  type: NodeType;
  label: string;
  description: string;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  defaultData: () => Record<string, unknown>;
  /** At most one of these per pipeline. */
  singleton: boolean;
}

// Node data shapes are type aliases (not interfaces) so they satisfy the
// Record<string, unknown> index signature of PipelineNode.data.
export type ImageInputData = {
  /** Optional fixed image; when null the Generate view supplies the image(s). */
  imagePath: string | null;
};

export type BackgroundRemovalData = {
  enabled: boolean;
};

export type MeshGeneratorData = {
  modelId: string;
  settings: Record<string, number | string | boolean>;
};

export type PostProcessData = {
  removeFloaters: boolean;
  removeDegenerateFaces: boolean;
  maxFaces: number | null;
  smoothNormals: boolean;
};

export type MeshExportData = {
  format: ExportFormat;
  /** Tokens: {image} {model} {pipeline} {date} {time} {seed} {n}. */
  namePattern: string;
};

export const NODE_DEFINITIONS: Record<NodeType, NodeDefinition> = {
  'image-input': {
    type: 'image-input',
    label: 'Image Input',
    description: 'The source image. Leave empty to pick images at generate time.',
    inputs: [],
    outputs: [{ id: 'image', label: 'Image', type: 'image' }],
    defaultData: (): ImageInputData => ({ imagePath: null }),
    singleton: true,
  },
  'background-removal': {
    type: 'background-removal',
    label: 'Background Removal',
    description: 'Cuts the subject out before conditioning. Strongly recommended for photos.',
    inputs: [{ id: 'image', label: 'Image', type: 'image' }],
    outputs: [{ id: 'image', label: 'Image', type: 'image' }],
    defaultData: (): BackgroundRemovalData => ({ enabled: true }),
    singleton: true,
  },
  'mesh-generator': {
    type: 'mesh-generator',
    label: 'Mesh Generator',
    description: 'Runs an image-to-3D model. Settings depend on the selected model.',
    inputs: [{ id: 'image', label: 'Image', type: 'image' }],
    outputs: [{ id: 'mesh', label: 'Mesh', type: 'mesh' }],
    defaultData: (): MeshGeneratorData => {
      const model = MODELS[0]!;
      return { modelId: model.id, settings: defaultModelSettings(model) };
    },
    singleton: true,
  },
  'post-process': {
    type: 'post-process',
    label: 'Post-Process',
    description: 'Clean up floaters and degenerate faces, optionally decimate.',
    inputs: [{ id: 'mesh', label: 'Mesh', type: 'mesh' }],
    outputs: [{ id: 'mesh', label: 'Mesh', type: 'mesh' }],
    defaultData: (): PostProcessData => ({
      removeFloaters: true,
      removeDegenerateFaces: true,
      maxFaces: null,
      smoothNormals: false,
    }),
    singleton: true,
  },
  'mesh-export': {
    type: 'mesh-export',
    label: 'Mesh Export',
    description: 'Writes the result into ~/.local-mesh/outputs.',
    inputs: [{ id: 'mesh', label: 'Mesh', type: 'mesh' }],
    outputs: [],
    defaultData: (): MeshExportData => ({ format: 'glb', namePattern: '{image}-{model}-{time}' }),
    singleton: true,
  },
};

export interface PipelineNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface PipelineEdge {
  id: string;
  from: { node: string; port: string };
  to: { node: string; port: string };
}

export interface Pipeline {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
}

export interface PipelineSummary {
  id: string;
  name: string;
  description: string;
  updatedAt: number;
  /** Model used by the mesh-generator node, for list badges. */
  modelId: string | null;
  /** Image Input node's fixed image, when the pipeline carries its own. */
  fixedImagePath: string | null;
  nodeCount: number;
}

export function summarizePipeline(p: Pipeline): PipelineSummary {
  const gen = p.nodes.find((n) => n.type === 'mesh-generator');
  const input = p.nodes.find((n) => n.type === 'image-input');
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    updatedAt: p.updatedAt,
    modelId: gen ? ((gen.data as Partial<MeshGeneratorData>).modelId ?? null) : null,
    fixedImagePath: input ? ((input.data as Partial<ImageInputData>).imagePath ?? null) : null,
    nodeCount: p.nodes.length,
  };
}

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createNode(type: NodeType, position: { x: number; y: number }): PipelineNode {
  return { id: newId(type), type, position, data: NODE_DEFINITIONS[type].defaultData() };
}

/** The pipeline every fresh install gets: the full canonical chain. */
export function createDefaultPipeline(name = 'Default', modelId?: string): Pipeline {
  const now = Date.now();
  const input = createNode('image-input', { x: 40, y: 160 });
  const bg = createNode('background-removal', { x: 320, y: 160 });
  const gen = createNode('mesh-generator', { x: 600, y: 120 });
  const post = createNode('post-process', { x: 920, y: 160 });
  const out = createNode('mesh-export', { x: 1200, y: 160 });
  if (modelId && getModel(modelId)) {
    gen.data = { modelId, settings: defaultModelSettings(getModel(modelId)!) };
  }
  const edge = (a: PipelineNode, ap: string, b: PipelineNode, bp: string): PipelineEdge => ({
    id: newId('edge'),
    from: { node: a.id, port: ap },
    to: { node: b.id, port: bp },
  });
  return {
    id: newId('pipeline'),
    name,
    description: 'Image → background removal → mesh → clean-up → GLB',
    createdAt: now,
    updatedAt: now,
    nodes: [input, bg, gen, post, out],
    edges: [
      edge(input, 'image', bg, 'image'),
      edge(bg, 'image', gen, 'image'),
      edge(gen, 'mesh', post, 'mesh'),
      edge(post, 'mesh', out, 'mesh'),
    ],
  };
}

// ---------------------------------------------------------------------------
// Validation + compilation
// ---------------------------------------------------------------------------

export interface PipelineIssue {
  level: 'error' | 'warning';
  message: string;
  nodeId?: string;
}

/** Follow the single incoming edge into `nodeId`/`port`, returning the upstream node. */
function upstream(p: Pipeline, nodeId: string, port: string): PipelineNode | null {
  const edge = p.edges.find((e) => e.to.node === nodeId && e.to.port === port);
  if (!edge) return null;
  return p.nodes.find((n) => n.id === edge.from.node) ?? null;
}

/**
 * Walk backwards from mesh-export and collect the chain. Returns issues for
 * anything that would stop a job being built. Pure: safe in both processes.
 */
export function validatePipeline(p: Pipeline): PipelineIssue[] {
  const issues: PipelineIssue[] = [];
  const byType = (t: NodeType) => p.nodes.filter((n) => n.type === t);

  for (const def of Object.values(NODE_DEFINITIONS)) {
    if (def.singleton && byType(def.type).length > 1) {
      issues.push({ level: 'error', message: `Only one ${def.label} node is allowed.` });
    }
  }
  const exportNode = byType('mesh-export')[0];
  const genNode = byType('mesh-generator')[0];
  const inputNode = byType('image-input')[0];
  if (!inputNode) issues.push({ level: 'error', message: 'Add an Image Input node.' });
  if (!genNode) issues.push({ level: 'error', message: 'Add a Mesh Generator node.' });
  if (!exportNode) issues.push({ level: 'error', message: 'Add a Mesh Export node.' });
  if (!inputNode || !genNode || !exportNode) return issues;

  const model = getModel(String((genNode.data as Partial<MeshGeneratorData>).modelId ?? ''));
  if (!model) {
    issues.push({ level: 'error', message: 'Mesh Generator has no model selected.', nodeId: genNode.id });
  }

  // Trace the mesh chain: export ← (post-process)* ← generator
  let cursor: PipelineNode | null = exportNode;
  let guard = 0;
  while (cursor && cursor.type !== 'mesh-generator' && guard++ < 32) {
    const inPort: PortDefinition | undefined = NODE_DEFINITIONS[cursor.type].inputs[0];
    const up: PipelineNode | null = inPort ? upstream(p, cursor.id, inPort.id) : null;
    if (!up) {
      issues.push({ level: 'error', message: `${NODE_DEFINITIONS[cursor.type].label} has nothing connected.`, nodeId: cursor.id });
      return issues;
    }
    cursor = up;
  }
  if (!cursor || cursor.type !== 'mesh-generator') {
    issues.push({ level: 'error', message: 'Mesh Export is not connected to the Mesh Generator.' });
    return issues;
  }

  // Trace the image chain: generator ← (background-removal)* ← input
  cursor = genNode;
  guard = 0;
  while (cursor && cursor.type !== 'image-input' && guard++ < 32) {
    const inPort: PortDefinition | undefined = NODE_DEFINITIONS[cursor.type].inputs[0];
    const up: PipelineNode | null = inPort ? upstream(p, cursor.id, inPort.id) : null;
    if (!up) {
      issues.push({ level: 'error', message: `${NODE_DEFINITIONS[cursor.type].label} has no image connected.`, nodeId: cursor.id });
      return issues;
    }
    cursor = up;
  }
  if (!cursor || cursor.type !== 'image-input') {
    issues.push({ level: 'error', message: 'Mesh Generator is not connected to the Image Input.' });
  }

  if (!byType('background-removal').some((n) => (n.data as BackgroundRemovalData).enabled)) {
    issues.push({ level: 'warning', message: 'No background removal: photos with backgrounds will generate poorly.' });
  }
  return issues;
}

export interface CompileContext {
  jobId: string;
  /** Absolute path under inputs/ of the image for this job. */
  imagePath: string;
  /** Stem of the original image file, for {image}. */
  imageStem: string;
  outputDir: string;
  pipelineName: string;
  /** Resolved seed (main picks one when the node says -1). */
  seed: number;
  /** Job index within a batch, for {n}. */
  index: number;
  now: Date;
}

function slug(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'mesh';
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

/**
 * Fold a validated pipeline into a worker job. Throws on validation errors,
 * so call validatePipeline() first in the UI and treat a throw here as a bug.
 */
export function compilePipeline(p: Pipeline, ctx: CompileContext): GenerationJobSpec {
  const errors = validatePipeline(p).filter((i) => i.level === 'error');
  if (errors.length) throw new Error(errors.map((e) => e.message).join(' '));

  const genNode = p.nodes.find((n) => n.type === 'mesh-generator')!;
  const genData = genNode.data as MeshGeneratorData;
  const model = getModel(genData.modelId)!;
  const settings: Record<string, number | string | boolean> = {
    ...defaultModelSettings(model),
    ...(genData.settings ?? {}),
  };
  settings['seed'] = ctx.seed;

  const bgNode = p.nodes.find((n) => n.type === 'background-removal');
  const removeBackground = bgNode ? Boolean((bgNode.data as BackgroundRemovalData).enabled) : false;

  const postNode = p.nodes.find((n) => n.type === 'post-process');
  const postDefaults = NODE_DEFINITIONS['post-process'].defaultData() as PostProcessData;
  const postProcess: PostProcessSpec = postNode
    ? { ...postDefaults, ...(postNode.data as Partial<PostProcessData>) }
    : { removeFloaters: false, removeDegenerateFaces: false, maxFaces: null, smoothNormals: false };

  const exportNode = p.nodes.find((n) => n.type === 'mesh-export')!;
  const exportData = { ...(NODE_DEFINITIONS['mesh-export'].defaultData() as MeshExportData), ...(exportNode.data as Partial<MeshExportData>) };
  const d = ctx.now;
  const baseName = slug(
    exportData.namePattern
      .replace('{image}', ctx.imageStem)
      .replace('{model}', model.id)
      .replace('{pipeline}', ctx.pipelineName)
      .replace('{date}', `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`)
      .replace('{time}', `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`)
      .replace('{seed}', String(ctx.seed))
      .replace('{n}', pad(ctx.index + 1))
  );

  return {
    jobId: ctx.jobId,
    modelId: model.id,
    imagePath: ctx.imagePath,
    removeBackground,
    settings,
    postProcess,
    export: { format: exportData.format, outputDir: ctx.outputDir, baseName },
  };
}
