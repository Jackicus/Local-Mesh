/**
 * Plain-language layer over the registry.
 *
 * `core/models.ts` is written for someone who already knows what a rectified
 * flow model is; this view is where a beginner lands when nothing works yet.
 * So every string a first-time user reads comes from here, and the registry's
 * own `description` is kept as the expert line behind the details disclosure.
 *
 * Adding a model to the registry without adding a blurb here is fine — the
 * registry description is used verbatim as the fallback.
 */
import type { EnvPhase, ModelDefinition, ModelTag } from '../../../core/types';

/** One sentence per model, written for someone choosing their first one. */
const BLURB: Record<string, string> = {
  triposr:
    'The quick one. Turns an image into a rough shape in seconds, so it is the cheapest way to check a photo works before you spend time on a slower model.',
  'hunyuan3d-2mini':
    'The all-rounder, and the one to pick if you are not sure. Clean, detailed shapes from a modest graphics card, with a turbo setting that trades a little detail for speed.',
  'hunyuan3d-2':
    'The full-size version of the mini: smoother surfaces and finer detail, for a bit more graphics memory and a bit more time per mesh.',
  triposg:
    'Very sharp geometry, but it runs right up to the edge of an 8 GB card. Worth trying once you have the smaller models working.',
  'hunyuan3d-2.1':
    'The sharpest shapes in this list. It is built for a 12 GB card and will not fit in 8 GB.',
  'step1x-3d':
    'Sharp shapes under an Apache-2.0 licence, so nothing here limits commercial use. Built for a 12 GB card.',
  trellis:
    'Works in a completely different way to the rest, so it succeeds and fails on different images. Built for a 16 GB card.',
  mock:
    'Not a real model: it makes a simple shape instantly, with nothing to download and no graphics card needed. Use it to check Local Mesh works end to end.',
};

export function blurb(model: ModelDefinition): string {
  return BLURB[model.id] ?? model.description;
}

/** Registry tags, said out loud. Tags with nothing useful to add are dropped. */
const TAG: Partial<Record<ModelTag, { label: string; variant: 'accent' | 'neutral' | 'warning' }>> = {
  recommended: { label: 'Best first pick', variant: 'accent' },
  fast: { label: 'Fast', variant: 'neutral' },
  quality: { label: 'Sharper detail', variant: 'neutral' },
  tiny: { label: 'Small download', variant: 'neutral' },
  experimental: { label: 'Experimental', variant: 'warning' },
  'no-gpu': { label: 'No graphics card needed', variant: 'neutral' },
};

export function tagLabels(model: ModelDefinition) {
  return model.tags.map((tag) => TAG[tag]).filter((t): t is NonNullable<typeof t> => Boolean(t));
}

/** Environment setup phases, said out loud. */
export const PHASE_LABEL: Record<EnvPhase, string> = {
  idle: 'Waiting',
  checking: 'Checking what is already here',
  'creating-venv': 'Making a private Python folder',
  'installing-torch': 'Downloading PyTorch — the biggest part',
  'installing-base': 'Installing the shared packages',
  verifying: 'Checking everything loads',
  done: 'Done',
  failed: 'Stopped with an error',
  cancelled: 'Stopped',
};

/** What each of the three install steps actually is, in one sentence. */
export const STEP_HELP = {
  engine: 'The shared groundwork every model runs on, kept inside Local Mesh. Installed once, and nothing is added to the rest of your computer.',
  files: 'The model itself, downloaded straight from Hugging Face.',
  extras: 'A few smaller pieces this particular model needs on top of the shared ones.',
} as const;

export const UV_INSTALL = 'curl -LsSf https://astral.sh/uv/install.sh | sh';
export const UV_HOME = 'https://docs.astral.sh/uv/getting-started/installation/';
