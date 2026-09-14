/**
 * The model registry. This is the single source of truth for what the app can
 * run: the Models view renders it, the mesh-generator node builds its settings
 * form from `settings`, and the main process uses `hfRepo` / `requirements` /
 * `backend` to download and run each one. Each `backend` name is resolved to a
 * python class by resources/python/backends/registry.py — usually the module of
 * the same name, occasionally a second class in a shared module (the two
 * Hunyuan3D 2.0 tiers differ only by checkpoint folder).
 *
 * VRAM/disk numbers are estimates for image -> shape (no texture). Keep entries
 * honest: the list spans 4 GB cards to 16 GB ones, and the Models view compares
 * `vramGb` against the card it finds, so an optimistic number reads as a
 * promise. Entries are ordered by `vramGb` ascending, with `mock` last.
 */
export type ModelSettingType = 'number' | 'select' | 'boolean' | 'seed';

export interface ModelSettingOption {
  value: string | number;
  label: string;
}

export interface ModelSetting {
  key: string;
  label: string;
  description?: string;
  type: ModelSettingType;
  default: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: ModelSettingOption[];
  /** Hidden behind an "Advanced" disclosure in the node UI. */
  advanced?: boolean;
}

export type ModelTag = 'recommended' | 'fast' | 'quality' | 'tiny' | 'experimental' | 'no-gpu';

/**
 * An additional Hugging Face repo a backend loads at runtime on top of its own
 * weights. The worker runs with HF_HUB_OFFLINE=1, so anything a library would
 * otherwise pull from the Hub on first load has to be on disk already: the
 * weights step fetches each of these into `models/<id>/<dir>` alongside the
 * main snapshot and lists them in the same `.complete` manifest.
 */
export interface ModelExtraRepo {
  /** Hugging Face repo id, e.g. "facebook/dino-vitb16". */
  repo: string;
  /** Subdirectory under `models/<id>` the snapshot lands in. */
  dir: string;
  /** snapshot_download allow_patterns; omit to fetch the whole repo. */
  allowPatterns?: string[];
  /** Why the backend needs it, for the Models view and the logs. */
  note?: string;
}

export interface ModelDefinition {
  id: string;
  name: string;
  vendor: string;
  description: string;
  /** Hugging Face repo id, e.g. "tencent/Hunyuan3D-2mini". Empty for local-only backends. */
  hfRepo: string;
  /** snapshot_download allow_patterns; omit to fetch the whole repo. */
  hfAllowPatterns?: string[];
  /** Extra Hub repos the backend loads; fetched into `models/<id>/<dir>` by the weights step. */
  extraRepos?: ModelExtraRepo[];
  params: string;
  /** Estimated peak VRAM in GB for image -> mesh. */
  vramGb: number;
  /** Approximate download size in GB. */
  diskGb: number;
  license: string;
  releaseDate: string; // YYYY-MM
  homepage: string;
  /** python module name under resources/python/backends/ */
  backend: string;
  /** requirements file under resources/python/requirements/ (null = base env only) */
  requirements: string | null;
  settings: ModelSetting[];
  tags: ModelTag[];
  /** True when the backend can drop its conditioner to CPU for low VRAM cards. */
  supportsLowVram: boolean;
}

export type WeightsState = 'none' | 'partial' | 'complete';
export type DepsState = 'unknown' | 'missing' | 'installed';

export interface ModelInstallState {
  id: string;
  weights: WeightsState;
  deps: DepsState;
  /** Bytes on disk under models/<id>. */
  sizeBytes: number;
  /** Absolute directory of the snapshot. */
  dir: string;
  /** Both weights complete and deps installed. */
  ready: boolean;
}

export type ModelDownloadStatus =
  | 'starting'
  | 'downloading'
  | 'installing-deps'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface ModelDownloadProgress {
  modelId: string;
  /** Which action this progress belongs to: the weights download or the deps install. */
  kind: 'weights' | 'deps';
  status: ModelDownloadStatus;
  /** 0-100 for the current status; weights and deps report separately. */
  pct: number;
  downloadedBytes: number;
  totalBytes: number;
  /** Current file, or pip line. */
  message: string;
  error?: string;
}

const SEED: ModelSetting = {
  key: 'seed',
  label: 'Seed',
  description: '-1 picks a random seed for every job',
  type: 'seed',
  default: -1,
};

export const MODELS: ModelDefinition[] = [
  {
    id: 'triposr',
    name: 'TripoSR',
    vendor: 'Stability AI / Tripo',
    description:
      'Single-pass feed-forward reconstruction. Seconds per mesh and well under 8GB; lower fidelity than the diffusion models but a great fast preview.',
    hfRepo: 'stabilityai/TripoSR',
    hfAllowPatterns: ['model.ckpt', 'config.yaml', '*.md'],
    // config.yaml points the image tokenizer at facebook/dino-vitb16, which the
    // repo fetches from the Hub at load time. The worker is offline, so the
    // encoder has to come down with the weights.
    extraRepos: [
      {
        repo: 'facebook/dino-vitb16',
        dir: 'dino-vitb16',
        allowPatterns: ['config.json', 'preprocessor_config.json', 'pytorch_model.bin'],
        note: 'DINO image encoder',
      },
    ],
    params: '~0.5B',
    vramGb: 4,
    diskGb: 2.1,
    license: 'MIT',
    releaseDate: '2024-03',
    homepage: 'https://huggingface.co/stabilityai/TripoSR',
    backend: 'triposr',
    requirements: 'triposr.txt',
    settings: [
      {
        key: 'mcResolution',
        label: 'Marching cubes resolution',
        type: 'select',
        default: 256,
        options: [
          { value: 128, label: '128' },
          { value: 256, label: '256' },
          { value: 320, label: '320' },
        ],
      },
      { key: 'chunkSize', label: 'Chunk size', description: 'Lower uses less VRAM during decode.', type: 'number', default: 8192, min: 1024, max: 65536, step: 1024, advanced: true },
      { key: 'foregroundRatio', label: 'Foreground ratio', type: 'number', default: 0.85, min: 0.5, max: 1, step: 0.05, advanced: true },
    ],
    tags: ['fast', 'tiny'],
    supportsLowVram: true,
  },
  {
    id: 'hunyuan3d-2mini',
    name: 'Hunyuan3D 2 mini',
    vendor: 'Tencent',
    description:
      'The 0.6B shape model from the Hunyuan3D 2 family. Best quality-per-gigabyte on an 8GB card; the turbo variant trades a little detail for ~5 steps.',
    hfRepo: 'tencent/Hunyuan3D-2mini',
    // Each DiT folder ships the same weights as .ckpt AND .safetensors (3.8 GB
    // each); take only the safetensors. The VAE weights are inside the DiT
    // checkpoint, so the separate vae folders are not needed.
    hfAllowPatterns: [
      'hunyuan3d-dit-v2-mini/*.safetensors',
      'hunyuan3d-dit-v2-mini/config.yaml',
      'hunyuan3d-dit-v2-mini-turbo/*.safetensors',
      'hunyuan3d-dit-v2-mini-turbo/config.yaml',
      '*.md',
      '*.json',
    ],
    params: '0.6B',
    vramGb: 5,
    diskGb: 7.7,
    license: 'Tencent Hunyuan Community',
    releaseDate: '2025-03',
    homepage: 'https://huggingface.co/tencent/Hunyuan3D-2mini',
    backend: 'hunyuan3d_mini',
    requirements: 'hunyuan3d.txt',
    settings: [
      {
        key: 'variant',
        label: 'Variant',
        description: 'Each variant is a separate checkpoint; switching reloads the model.',
        type: 'select',
        default: 'turbo',
        options: [
          { value: 'turbo', label: 'Turbo (5 steps, fast)' },
          { value: 'standard', label: 'Standard (30-50 steps)' },
        ],
      },
      { key: 'steps', label: 'Steps', type: 'number', default: 5, min: 1, max: 100, step: 1 },
      { key: 'guidance', label: 'Guidance scale', type: 'number', default: 5, min: 0, max: 20, step: 0.5 },
      {
        key: 'octreeResolution',
        label: 'Octree resolution',
        description: 'Marching-cubes grid. 256 is a good default; 384+ needs more VRAM and time.',
        type: 'select',
        default: 256,
        options: [
          { value: 128, label: '128' },
          { value: 256, label: '256' },
          { value: 384, label: '384' },
          { value: 512, label: '512' },
        ],
      },
      { key: 'numChunks', label: 'Decode chunks', description: 'Higher = less VRAM during decode, slower.', type: 'number', default: 8000, min: 1000, max: 200000, step: 1000, advanced: true },
      { key: 'mcLevel', label: 'MC level', type: 'number', default: 0, min: -1, max: 1, step: 0.01, advanced: true },
      SEED,
    ],
    tags: ['recommended', 'quality'],
    supportsLowVram: true,
  },
  {
    id: 'hunyuan3d-2',
    name: 'Hunyuan3D 2',
    vendor: 'Tencent',
    description:
      'The full 1.1B shape model the mini was distilled from: noticeably cleaner surfaces and finer detail. Needs a 6GB card.',
    hfRepo: 'tencent/Hunyuan3D-2',
    // Each DiT folder publishes the same weights twice (.ckpt and
    // .safetensors), and hunyuan3d-dit-v2-0 adds fp32 duplicates on top, so a
    // `*.safetensors` glob would fetch 9.9 GB where 4.9 GB is needed. Name the
    // fp16 safetensors file exactly. As with the mini, the VAE and the DINOv2
    // conditioner live inside the DiT checkpoint, so hunyuan3d-vae-v2-0* is not
    // needed; hunyuan3d-paint-* and -delight-* are texture-only.
    hfAllowPatterns: [
      'hunyuan3d-dit-v2-0-turbo/model.fp16.safetensors',
      'hunyuan3d-dit-v2-0-turbo/config.yaml',
      'hunyuan3d-dit-v2-0/model.fp16.safetensors',
      'hunyuan3d-dit-v2-0/config.yaml',
      '*.md',
      '*.json',
    ],
    params: '1.1B',
    vramGb: 6,
    diskGb: 9.9,
    license: 'Tencent Hunyuan Community',
    releaseDate: '2025-01',
    homepage: 'https://huggingface.co/tencent/Hunyuan3D-2',
    backend: 'hunyuan3d_2',
    requirements: 'hunyuan3d.txt',
    settings: [
      {
        key: 'variant',
        label: 'Variant',
        description: 'Each variant is a separate checkpoint; switching reloads the model.',
        type: 'select',
        default: 'turbo',
        options: [
          { value: 'turbo', label: 'Turbo (5 steps, fast)' },
          { value: 'standard', label: 'Standard (30-50 steps)' },
        ],
      },
      { key: 'steps', label: 'Steps', type: 'number', default: 5, min: 1, max: 100, step: 1 },
      { key: 'guidance', label: 'Guidance scale', type: 'number', default: 5, min: 0, max: 20, step: 0.5 },
      {
        key: 'octreeResolution',
        label: 'Octree resolution',
        description: 'Marching-cubes grid. 384 matches the upstream demo; 512 needs more VRAM and time.',
        type: 'select',
        default: 384,
        options: [
          { value: 128, label: '128' },
          { value: 256, label: '256' },
          { value: 384, label: '384' },
          { value: 512, label: '512' },
        ],
      },
      { key: 'numChunks', label: 'Decode chunks', description: 'Higher = less VRAM during decode, slower.', type: 'number', default: 8000, min: 1000, max: 200000, step: 1000, advanced: true },
      { key: 'mcLevel', label: 'MC level', type: 'number', default: 0, min: -1, max: 1, step: 0.01, advanced: true },
      SEED,
    ],
    tags: ['quality'],
    supportsLowVram: true,
  },
  {
    id: 'triposg',
    name: 'TripoSG',
    vendor: 'VAST AI',
    description:
      '1.5B rectified-flow shape model, near state-of-the-art geometry. The vendor states 8GB minimum: expect it to be tight on this card, keep resolution modest and low-VRAM mode on.',
    hfRepo: 'VAST-AI/TripoSG',
    params: '1.5B',
    vramGb: 7.5,
    diskGb: 7.4,
    license: 'MIT',
    releaseDate: '2025-02',
    homepage: 'https://huggingface.co/VAST-AI/TripoSG',
    backend: 'triposg',
    requirements: 'triposg.txt',
    settings: [
      { key: 'steps', label: 'Steps', type: 'number', default: 50, min: 1, max: 100, step: 1 },
      { key: 'guidance', label: 'Guidance scale', type: 'number', default: 7, min: 0, max: 20, step: 0.5 },
      {
        key: 'octreeResolution',
        label: 'Octree resolution',
        description: 'Power of two: the decoder works in octree depths.',
        type: 'select',
        default: 256,
        options: [
          { value: 128, label: '128' },
          { value: 256, label: '256' },
          { value: 512, label: '512 (needs headroom)' },
        ],
      },
      SEED,
    ],
    tags: ['quality', 'experimental'],
    supportsLowVram: true,
  },
  {
    id: 'hunyuan3d-2.1',
    name: 'Hunyuan3D 2.1',
    vendor: 'Tencent',
    description:
      'The 3.3B successor to Hunyuan3D 2, the sharpest geometry in this list. Needs a 12GB card; it will not fit in 8GB.',
    hfRepo: 'tencent/Hunyuan3D-2.1',
    // 2.1 publishes no safetensors at all — the shape DiT is model.fp16.ckpt
    // (7.4 GB), loaded with torch.load(weights_only=True). Its config.yaml
    // declares the VAE and the DINOv2 conditioner inline, so both live inside
    // that one checkpoint and hunyuan3d-vae-v2-1 is not needed;
    // hunyuan3d-paintpbr-v2-1 and hy3dpaint are texture-only.
    hfAllowPatterns: ['hunyuan3d-dit-v2-1/model.fp16.ckpt', 'hunyuan3d-dit-v2-1/config.yaml', '*.md'],
    params: '3.3B',
    vramGb: 10,
    diskGb: 7.4,
    license: 'Tencent Hunyuan 3D 2.1 Community',
    releaseDate: '2025-06',
    homepage: 'https://huggingface.co/tencent/Hunyuan3D-2.1',
    backend: 'hunyuan3d_21',
    requirements: 'hunyuan3d21.txt',
    settings: [
      { key: 'steps', label: 'Steps', type: 'number', default: 50, min: 1, max: 100, step: 1 },
      { key: 'guidance', label: 'Guidance scale', type: 'number', default: 5, min: 0, max: 20, step: 0.5 },
      {
        key: 'octreeResolution',
        label: 'Octree resolution',
        description: 'Marching-cubes grid. 384 is the upstream default.',
        type: 'select',
        default: 384,
        options: [
          { value: 256, label: '256' },
          { value: 320, label: '320' },
          { value: 384, label: '384' },
          { value: 512, label: '512 (needs headroom)' },
        ],
      },
      { key: 'numChunks', label: 'Decode chunks', description: 'Higher = less VRAM during decode, slower.', type: 'number', default: 8000, min: 1000, max: 200000, step: 1000, advanced: true },
      { key: 'mcLevel', label: 'MC level', type: 'number', default: 0, min: -1, max: 1, step: 0.01, advanced: true },
      { key: 'boxV', label: 'Bounding box', description: 'Half-extent the grid is sampled over.', type: 'number', default: 1.01, min: 0.5, max: 2, step: 0.01, advanced: true },
      SEED,
    ],
    tags: ['quality'],
    supportsLowVram: true,
  },
  {
    id: 'step1x-3d',
    name: 'Step1X-3D Geometry',
    vendor: 'StepFun',
    description:
      'A 1.3B Flux-style shape model and the only Apache-2.0 entry at this size, so nothing here restricts commercial use. Needs a 12GB card.',
    hfRepo: 'stepfun-ai/Step1X-3D',
    // Geometry only: Step1X-3D-Texture (3.6 GB) and the Label-1300m variant
    // (a second 5.1 GB DiT with symmetry/edge conditioning) are skipped. The
    // DINOv2-with-registers encoder ships inside visual_encoder/, so there is
    // no extra Hub repo. `visual_eature_extractor` is misspelled upstream in
    // both the repo and the pipeline signature — do not "fix" it.
    hfAllowPatterns: ['Step1X-3D-Geometry-1300m/*'],
    params: '1.3B',
    vramGb: 10,
    diskGb: 7.3,
    license: 'Apache-2.0',
    releaseDate: '2025-05',
    homepage: 'https://github.com/stepfun-ai/Step1X-3D',
    backend: 'step1x3d',
    requirements: 'step1x3d.txt',
    settings: [
      { key: 'steps', label: 'Steps', type: 'number', default: 50, min: 1, max: 100, step: 1 },
      { key: 'guidance', label: 'Guidance scale', type: 'number', default: 7.5, min: 0, max: 20, step: 0.5 },
      {
        key: 'octreeResolution',
        label: 'Octree resolution',
        description: 'Marching-cubes grid. 384 is the upstream default.',
        type: 'select',
        default: 384,
        options: [
          { value: 256, label: '256' },
          { value: 320, label: '320' },
          { value: 384, label: '384' },
          { value: 512, label: '512 (needs headroom)' },
        ],
      },
      { key: 'mcLevel', label: 'MC level', type: 'number', default: 0, min: -1, max: 1, step: 0.01, advanced: true },
      { key: 'foregroundRatio', label: 'Foreground ratio', type: 'number', default: 0.95, min: 0.5, max: 1, step: 0.05, advanced: true },
      { key: 'maxFaces', label: 'Max faces', description: 'The pipeline decimates above this; 0 disables it.', type: 'number', default: 200000, min: 0, max: 500000, step: 10000, advanced: true },
      { key: 'bounds', label: 'Bounding box', description: 'Half-extent the grid is sampled over.', type: 'number', default: 1.05, min: 0.5, max: 2, step: 0.01, advanced: true },
      SEED,
    ],
    tags: ['quality'],
    supportsLowVram: true,
  },
  {
    id: 'trellis',
    name: 'TRELLIS image-large',
    vendor: 'Microsoft',
    description:
      'Sparse-voxel latents rather than a DiT over point clouds, so it fails differently from everything else here — and it is MIT. Needs a 16GB card.',
    hfRepo: 'microsoft/TRELLIS-image-large',
    // pipeline.json names six checkpoints and from_pretrained loads all of
    // them, including the gaussian and radiance-field decoders this backend
    // never runs — skipping those would send the loader to the Hub, and the
    // worker is offline. The two *encoders* are not in pipeline.json, so they
    // are the one thing safely left behind (~292 MB).
    hfAllowPatterns: [
      'pipeline.json',
      'ckpts/ss_flow_img_dit_L_16l8_fp16.*',
      'ckpts/ss_dec_conv3d_16l8_fp16.*',
      'ckpts/slat_flow_img_dit_L_64l8p2_fp16.*',
      'ckpts/slat_dec_mesh_swin8_B_64l8m256c_fp16.*',
      'ckpts/slat_dec_gs_swin8_B_64l8gs32_fp16.*',
      'ckpts/slat_dec_rf_swin8_B_64l8r16_fp16.*',
      '*.md',
    ],
    params: '1.2B',
    vramGb: 16,
    diskGb: 3,
    license: 'MIT',
    releaseDate: '2024-12',
    homepage: 'https://github.com/microsoft/TRELLIS',
    backend: 'trellis',
    requirements: 'trellis.txt',
    settings: [
      { key: 'ssSteps', label: 'Structure steps', description: 'Sparse-structure sampler: decides which voxels are occupied.', type: 'number', default: 12, min: 1, max: 50, step: 1 },
      { key: 'ssGuidance', label: 'Structure guidance', type: 'number', default: 7.5, min: 0, max: 10, step: 0.5 },
      { key: 'slatSteps', label: 'Latent steps', description: 'Structured-latent sampler: fills the occupied voxels with geometry.', type: 'number', default: 12, min: 1, max: 50, step: 1 },
      { key: 'slatGuidance', label: 'Latent guidance', type: 'number', default: 3, min: 0, max: 10, step: 0.5 },
      SEED,
    ],
    tags: ['experimental'],
    // Nothing to offload: the sparse decoders and xformers attention all have
    // to be resident, and there is no diffusers component map to walk.
    supportsLowVram: false,
  },
  {
    id: 'mock',
    name: 'Mock (procedural)',
    vendor: 'Local Mesh',
    description:
      'No download, no GPU: emits a procedural mesh with fake progress so the queue, viewer and logs can be exercised end-to-end.',
    hfRepo: '',
    params: '0',
    vramGb: 0,
    diskGb: 0,
    license: 'MIT',
    releaseDate: '2026-09',
    homepage: '',
    backend: 'mock',
    requirements: null,
    settings: [
      {
        key: 'shape',
        label: 'Shape',
        type: 'select',
        default: 'torus-knot',
        options: [
          { value: 'torus-knot', label: 'Torus knot' },
          { value: 'sphere', label: 'Icosphere' },
          { value: 'box', label: 'Box' },
        ],
      },
      { key: 'seconds', label: 'Fake duration (s)', type: 'number', default: 4, min: 0, max: 60, step: 1 },
      SEED,
    ],
    tags: ['tiny', 'no-gpu'],
    supportsLowVram: false,
  },
];

export const MODEL_BY_ID: Record<string, ModelDefinition> = Object.fromEntries(
  MODELS.map((m) => [m.id, m])
);

export function getModel(id: string): ModelDefinition | undefined {
  return MODEL_BY_ID[id];
}

/** Default settings object for a model, straight from its registry entry. */
export function defaultModelSettings(model: ModelDefinition): Record<string, number | string | boolean> {
  return Object.fromEntries(model.settings.map((s) => [s.key, s.default]));
}
