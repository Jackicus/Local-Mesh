import type { ExportFormat, GenerationJobSpec, MeshOp, MeshOpKind } from './generation';
import { MESH_OP_DEFINITIONS, MESH_OP_KINDS, isMeshOpKind, normalizeMeshOp } from './generation';
import { defaultModelSettings, getModel, MODELS } from './models';

/**
 * A pipeline is a small node graph the Generate view runs against one or more
 * images. Ports are typed ('image' | 'mesh'); an edge connects an output port
 * to an input port of the same type. Node `data` is a flat JSON object whose
 * shape is defined per node type below.
 *
 * The canonical chain is:
 *   image-input → (background-removal) → mesh-generator → (mesh ops)* → mesh-export
 * Optional nodes are pass-throughs when absent. Each mesh op is its own node
 * type (one per MeshOpKind), so a pipeline can run them in any order and more
 * than once. compilePipeline() walks the graph and folds it into a
 * GenerationJobSpec for the python worker.
 */
export type PortType = 'image' | 'mesh';

export type NodeType =
  | 'image-input'
  | 'background-removal'
  | 'mesh-generator'
  | MeshOpKind
  | 'mesh-export';

/** The node types that carry a mesh op; their id is the op kind itself. */
export function isMeshOpNodeType(type: NodeType): type is MeshOpKind {
  return isMeshOpKind(type);
}

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

/**
 * A mesh op node's data is its op without the `op` key - the node type already
 * says which op it is, so the data never contradicts the graph.
 */
export type MeshOpData = Record<string, unknown>;

function opData(op: MeshOp): MeshOpData {
  const data: MeshOpData = { ...op };
  delete data['op'];
  return data;
}

export function meshOpNodeData(kind: MeshOpKind): MeshOpData {
  return opData(MESH_OP_DEFINITIONS[kind].defaults());
}

/** The op a node stands for, falling back to defaults rather than throwing. */
export function meshOpFromNode(node: PipelineNode): MeshOp {
  const kind = node.type as MeshOpKind;
  try {
    return normalizeMeshOp({ ...node.data, op: kind });
  } catch {
    return MESH_OP_DEFINITIONS[kind].defaults();
  }
}

export type MeshExportData = {
  format: ExportFormat;
  /** Tokens: {image} {model} {pipeline} {date} {time} {seed} {n}. */
  namePattern: string;
};

/** One node definition per mesh op; unlike the rest, these chain and repeat. */
function meshOpDefinitions(): Record<MeshOpKind, NodeDefinition> {
  const entries = MESH_OP_KINDS.map((kind): [MeshOpKind, NodeDefinition] => [
    kind,
    {
      type: kind,
      label: MESH_OP_DEFINITIONS[kind].label,
      description: MESH_OP_DEFINITIONS[kind].description,
      inputs: [{ id: 'mesh', label: 'Mesh', type: 'mesh' }],
      outputs: [{ id: 'mesh', label: 'Mesh', type: 'mesh' }],
      defaultData: () => meshOpNodeData(kind),
      singleton: false,
    },
  ]);
  return Object.fromEntries(entries) as Record<MeshOpKind, NodeDefinition>;
}

export const NODE_DEFINITIONS: Record<NodeType, NodeDefinition> = {
  'image-input': {
    type: 'image-input',
    label: 'Image Input',
    description:
      'The image every run starts from. Leave it empty to pick images at generate time, or set one here to pin the pipeline to a single image.',
    inputs: [],
    outputs: [{ id: 'image', label: 'Image', type: 'image' }],
    defaultData: (): ImageInputData => ({ imagePath: null }),
    singleton: true,
  },
  'background-removal': {
    type: 'background-removal',
    label: 'Background Removal',
    description:
      'Cuts the subject out of its background before the model sees it. Strongly recommended for photos — a model reads leftover background as geometry.',
    inputs: [{ id: 'image', label: 'Image', type: 'image' }],
    outputs: [{ id: 'image', label: 'Image', type: 'image' }],
    defaultData: (): BackgroundRemovalData => ({ enabled: true }),
    singleton: true,
  },
  'mesh-generator': {
    type: 'mesh-generator',
    label: 'Mesh Generator',
    description:
      'Runs an image-to-3D model and emits an untextured mesh. This is the slow step; the settings below belong to whichever model is picked.',
    inputs: [{ id: 'image', label: 'Image', type: 'image' }],
    outputs: [{ id: 'mesh', label: 'Mesh', type: 'mesh' }],
    defaultData: (): MeshGeneratorData => {
      const model = MODELS[0]!;
      return { modelId: model.id, settings: defaultModelSettings(model) };
    },
    singleton: true,
  },
  ...meshOpDefinitions(),
  'mesh-export': {
    type: 'mesh-export',
    label: 'Mesh Export',
    description: 'Writes the finished mesh into ~/.local-mesh/outputs, in the chosen format and under the chosen name.',
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

/** The gap between nodes laid out automatically (default pipeline, migration). */
const NODE_SPACING = 300;

function connect(a: PipelineNode, ap: string, b: PipelineNode, bp: string): PipelineEdge {
  return { id: newId('edge'), from: { node: a.id, port: ap }, to: { node: b.id, port: bp } };
}

/** The pipeline every fresh install gets: the full canonical chain. */
export function createDefaultPipeline(name = 'Default', modelId?: string): Pipeline {
  const now = Date.now();
  const input = createNode('image-input', { x: 40, y: 160 });
  const bg = createNode('background-removal', { x: 340, y: 160 });
  const gen = createNode('mesh-generator', { x: 640, y: 120 });
  const floaters = createNode('remove-floaters', { x: 940, y: 160 });
  const clean = createNode('remove-degenerate', { x: 1240, y: 160 });
  const out = createNode('mesh-export', { x: 1540, y: 160 });
  if (modelId && getModel(modelId)) {
    gen.data = { modelId, settings: defaultModelSettings(getModel(modelId)!) };
  }
  return {
    id: newId('pipeline'),
    name,
    description: 'Image → background removal → mesh → clean-up → GLB',
    createdAt: now,
    updatedAt: now,
    nodes: [input, bg, gen, floaters, clean, out],
    edges: [
      connect(input, 'image', bg, 'image'),
      connect(bg, 'image', gen, 'image'),
      connect(gen, 'mesh', floaters, 'mesh'),
      connect(floaters, 'mesh', clean, 'mesh'),
      connect(clean, 'mesh', out, 'mesh'),
    ],
  };
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/** What the single Post-Process node used to hold, before it was split up. */
type LegacyPostProcessData = {
  removeFloaters?: boolean;
  removeDegenerateFaces?: boolean;
  maxFaces?: number | null;
  smoothNormals?: boolean;
};

/** The ops a legacy Post-Process node enabled, in the order it ran them. */
function legacyOpNodes(data: LegacyPostProcessData, at: { x: number; y: number }): PipelineNode[] {
  const kinds: MeshOpKind[] = [];
  if (data.removeDegenerateFaces) kinds.push('remove-degenerate');
  if (data.removeFloaters) kinds.push('remove-floaters');
  if (data.maxFaces) kinds.push('decimate');
  if (data.smoothNormals) kinds.push('recompute-normals');
  return kinds.map((kind, i) => {
    const node = createNode(kind, { x: at.x + NODE_SPACING * i, y: at.y });
    if (kind === 'decimate') node.data = { ...node.data, mode: 'faces', maxFaces: Number(data.maxFaces) };
    return node;
  });
}

/**
 * Hunyuan3D 2's turbo and standard checkpoints used to be one registry entry
 * with a `variant` setting choosing between them; they are now separate models,
 * because bundling them meant downloading both to use either.
 *
 * A pipeline saved under the old scheme names the combined id and carries the
 * variant in its settings. Left alone it would keep the combined id — which now
 * means *standard* — while holding turbo's step count, so it would quietly run
 * the undistilled model at five steps and produce a visibly worse mesh than it
 * did yesterday. Rewrite the id to whichever checkpoint the pipeline was
 * actually using, and drop the setting that no longer exists.
 *
 * `variant` defaulted to turbo, so anything that is not explicitly standard was
 * running turbo.
 */
const SPLIT_VARIANTS: Record<string, { turbo: string; standard: string }> = {
  'hunyuan3d-2mini': { turbo: 'hunyuan3d-2mini-turbo', standard: 'hunyuan3d-2mini' },
  'hunyuan3d-2': { turbo: 'hunyuan3d-2-turbo', standard: 'hunyuan3d-2' },
};

function migrateGeneratorNode(node: PipelineNode): PipelineNode {
  const data = node.data as Partial<MeshGeneratorData>;
  const modelId = typeof data.modelId === 'string' ? data.modelId : '';
  const split = SPLIT_VARIANTS[modelId];
  const settings = { ...(data.settings ?? {}) };
  if (!split && !('variant' in settings)) return node;

  const wanted = split ? (settings['variant'] === 'standard' ? split.standard : split.turbo) : modelId;
  delete settings['variant'];
  if (wanted === modelId && Object.keys(settings).length === Object.keys(data.settings ?? {}).length) return node;
  return { ...node, data: { ...node.data, modelId: wanted, settings } };
}

/**
 * Bring a stored pipeline up to the current node vocabulary. Two migrations
 * live here: the one Post-Process node becomes the chain of individual op nodes
 * it had switched on, spliced into the wires it sat between; and a Mesh
 * Generator still naming a model that has since been split picks up the id it
 * meant. Returns the input untouched when there is nothing to do, so callers
 * can test for a change by identity.
 */
export function migratePipeline(p: Pipeline): Pipeline {
  const generators = p.nodes.filter((n) => n.type === 'mesh-generator');
  const migratedGenerators = new Map(
    generators.map((node) => [node.id, migrateGeneratorNode(node)] as const)
  );
  const generatorChanged = generators.some((node) => migratedGenerators.get(node.id) !== node);

  const legacy = p.nodes.filter((n) => (n.type as string) === 'post-process');
  if (legacy.length === 0) {
    return generatorChanged
      ? { ...p, nodes: p.nodes.map((n) => migratedGenerators.get(n.id) ?? n) }
      : p;
  }

  let nodes = p.nodes.map((n) => migratedGenerators.get(n.id) ?? n);
  let edges = p.edges;
  for (const node of legacy) {
    const chain = legacyOpNodes(node.data as LegacyPostProcessData, node.position);
    const incoming = edges.find((e) => e.to.node === node.id);
    const outgoing = edges.filter((e) => e.from.node === node.id);
    const shift = Math.max(0, chain.length - 1) * NODE_SPACING;

    nodes = nodes
      .filter((n) => n.id !== node.id)
      // Keep the rest of the graph clear of the nodes that replaced this one.
      .map((n) => (shift > 0 && n.position.x > node.position.x ? { ...n, position: { ...n.position, x: n.position.x + shift } } : n))
      .concat(chain);

    const head = chain[0];
    const tail = chain[chain.length - 1];
    edges = edges.filter((e) => e.from.node !== node.id && e.to.node !== node.id);
    if (!head || !tail) {
      // Nothing was enabled: stitch what fed the node straight to what it fed.
      if (incoming) {
        for (const out of outgoing) {
          edges = [...edges, { id: newId('edge'), from: { ...incoming.from }, to: { ...out.to } }];
        }
      }
      continue;
    }
    if (incoming) edges = [...edges, { id: newId('edge'), from: { ...incoming.from }, to: { node: head.id, port: 'mesh' } }];
    for (let i = 1; i < chain.length; i += 1) edges = [...edges, connect(chain[i - 1]!, 'mesh', chain[i]!, 'mesh')];
    for (const out of outgoing) {
      edges = [...edges, { id: newId('edge'), from: { node: tail.id, port: 'mesh' }, to: { ...out.to } }];
    }
  }
  return { ...p, nodes, edges };
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

function portOf(node: PipelineNode | undefined, id: string, side: 'inputs' | 'outputs'): PortDefinition | undefined {
  if (!node) return undefined;
  const def = NODE_DEFINITIONS[node.type] as NodeDefinition | undefined;
  return def?.[side].find((port) => port.id === id);
}

/**
 * Edges have to name real nodes and real ports, join an output to an input of
 * the same type, and land at most one wire on any input. Without this a
 * mistyped edge (image → mesh port) traces as a valid chain and then compiles
 * into a job that silently skips the nodes it skipped.
 */
function edgeIssues(p: Pipeline): PipelineIssue[] {
  const issues: PipelineIssue[] = [];
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const taken = new Set<string>();
  for (const edge of p.edges) {
    const from = byId.get(edge.from.node);
    const to = byId.get(edge.to.node);
    if (!from || !to) {
      issues.push({ level: 'error', message: 'A connection points at a node that is no longer there.' });
      continue;
    }
    const out = portOf(from, edge.from.port, 'outputs');
    const inp = portOf(to, edge.to.port, 'inputs');
    if (!out || !inp) {
      issues.push({
        level: 'error',
        message: `${NODE_DEFINITIONS[from.type].label} → ${NODE_DEFINITIONS[to.type].label} uses a port that does not exist.`,
        nodeId: to.id,
      });
      continue;
    }
    if (out.type !== inp.type) {
      issues.push({
        level: 'error',
        message: `${NODE_DEFINITIONS[from.type].label} (${out.type}) cannot connect to ${NODE_DEFINITIONS[to.type].label} (${inp.type}).`,
        nodeId: to.id,
      });
      continue;
    }
    const key = `${edge.to.node}:${edge.to.port}`;
    if (taken.has(key)) {
      issues.push({
        level: 'error',
        message: `${NODE_DEFINITIONS[to.type].label} has more than one thing connected to its ${inp.label} input.`,
        nodeId: to.id,
      });
      continue;
    }
    taken.add(key);
  }
  return issues;
}

/**
 * The nodes the compiled job actually runs, walking back from mesh-export.
 * Anything outside this set is dead weight the compiler drops.
 */
function reachableNodes(p: Pipeline, exportNode: PipelineNode): Set<string> {
  const seen = new Set<string>([exportNode.id]);
  const stack: PipelineNode[] = [exportNode];
  while (stack.length) {
    const node = stack.pop()!;
    for (const port of NODE_DEFINITIONS[node.type].inputs) {
      const up = upstream(p, node.id, port.id);
      if (up && !seen.has(up.id)) {
        seen.add(up.id);
        stack.push(up);
      }
    }
  }
  return seen;
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
  issues.push(...edgeIssues(p));

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

  // Trace the mesh chain: export ← (mesh op)* ← generator
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

  const reachable = reachableNodes(p, exportNode);
  for (const node of p.nodes) {
    if (reachable.has(node.id)) continue;
    issues.push({
      level: 'warning',
      message: `${NODE_DEFINITIONS[node.type].label} is not wired into the chain and will be ignored.`,
      nodeId: node.id,
    });
  }

  const bg = byType('background-removal')[0];
  if (!bg || !reachable.has(bg.id) || !(bg.data as BackgroundRemovalData).enabled) {
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
 * The op nodes between the generator and `exportNode`, in the order the mesh
 * flows through them. The chain is validated by then, so the walk always
 * terminates at the generator.
 */
function meshOpChain(p: Pipeline, exportNode: PipelineNode): MeshOp[] {
  const ops: MeshOp[] = [];
  let cursor: PipelineNode | null = upstream(p, exportNode.id, 'mesh');
  let guard = 0;
  while (cursor && cursor.type !== 'mesh-generator' && guard++ < 32) {
    if (isMeshOpNodeType(cursor.type)) ops.unshift(meshOpFromNode(cursor));
    cursor = upstream(p, cursor.id, NODE_DEFINITIONS[cursor.type].inputs[0]?.id ?? 'mesh');
  }
  // Never hand the worker a half-walked chain: validation bounds the walk the
  // same way, so reaching this means the graph changed underneath us.
  if (!cursor || cursor.type !== 'mesh-generator') {
    throw new Error('The mesh chain between the Mesh Generator and Mesh Export is broken or too long.');
  }
  return ops;
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

  const exportNode = p.nodes.find((n) => n.type === 'mesh-export')!;
  // Only a node the mesh/image actually flows through counts: a detached
  // Background Removal node left lying on the canvas must not affect the job.
  const reachable = reachableNodes(p, exportNode);
  const bgNode = p.nodes.find((n) => n.type === 'background-removal' && reachable.has(n.id));
  const removeBackground = bgNode ? Boolean((bgNode.data as BackgroundRemovalData).enabled) : false;

  const postProcess = meshOpChain(p, exportNode);
  const exportData = { ...(NODE_DEFINITIONS['mesh-export'].defaultData() as MeshExportData), ...(exportNode.data as Partial<MeshExportData>) };
  const d = ctx.now;
  const tokens: Record<string, string> = {
    image: ctx.imageStem,
    model: model.id,
    pipeline: ctx.pipelineName,
    date: `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`,
    time: `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`,
    seed: String(ctx.seed),
    n: pad(ctx.index + 1),
  };
  // A function replacement, so every occurrence is substituted and a `$` in an
  // image name is never read as a replacement pattern.
  const baseName = slug(exportData.namePattern.replace(/\{(\w+)\}/g, (match, key: string) => tokens[key] ?? match));

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
