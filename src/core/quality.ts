/**
 * Fast / Balanced / Detailed, expressed against whatever dials the chosen
 * model actually has.
 *
 * Every model names its knobs differently — `steps` here, `ssSteps` and
 * `slatSteps` there, `octreeResolution` in most and `mcResolution` in TripoSR —
 * so a preset cannot be a table of numbers. It is a rule applied to the
 * registry's own declarations: push the effort dials toward their floor or
 * ceiling, and step the resolution dial one option down or up from the default
 * the model shipped with. Balanced is the model's defaults, untouched.
 *
 * Everything not named below is deliberately left alone. Guidance, decode
 * chunking, marching-cubes level and foreground ratio change what comes out
 * without being "more" or "less" of it, and are the Pipelines view's business.
 */
import type { ModelDefinition, ModelSetting } from './models';

export type QualityPreset = 'fast' | 'balanced' | 'detailed';

export const QUALITY_PRESETS: Array<{ value: QualityPreset; label: string; hint: string }> = [
  { value: 'fast', label: 'Fast', hint: 'A rough shape in the least time. Good for checking a picture works.' },
  { value: 'balanced', label: 'Balanced', hint: 'What the model was tuned for. Start here.' },
  { value: 'detailed', label: 'Detailed', hint: 'Finer surfaces, more graphics memory, noticeably slower.' },
];

/** Dials where a bigger number means more work and a better surface. */
const EFFORT_KEYS = new Set(['steps', 'ssSteps', 'slatSteps']);

/** Dials that are a grid size, offered as a fixed set of options. */
const RESOLUTION_KEYS = new Set(['octreeResolution', 'mcResolution']);

/**
 * Hunyuan3D 2's two checkpoints are the single biggest speed lever it has, and
 * the step count that suits one is wrong for the other, so they move together.
 */
const VARIANT_STEPS: Record<string, number> = { turbo: 5, standard: 30 };

function clampNumber(setting: ModelSetting, value: number): number {
  const min = setting.min ?? Number.NEGATIVE_INFINITY;
  const max = setting.max ?? Number.POSITIVE_INFINITY;
  const stepped = setting.step && setting.step >= 1 ? Math.round(value) : value;
  return Math.min(max, Math.max(min, stepped));
}

/** One option down (fast) or up (detailed) from wherever the default sits. */
function shiftOption(setting: ModelSetting, current: unknown, direction: -1 | 1): unknown {
  const options = setting.options ?? [];
  if (options.length === 0) return current;
  const at = options.findIndex((o) => o.value === current);
  const from = at >= 0 ? at : options.findIndex((o) => o.value === setting.default);
  const next = Math.min(options.length - 1, Math.max(0, (from < 0 ? 0 : from) + direction));
  return options[next]!.value;
}

/**
 * The settings this preset implies for this model, as a full settings object
 * built from the model's defaults. Balanced returns the defaults unchanged.
 */
export function applyQuality(
  model: ModelDefinition,
  preset: QualityPreset,
  base: Record<string, number | string | boolean> = {}
): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = { ...base };

  for (const setting of model.settings) {
    // Never touched by a preset: the seed is the user's, and the advanced
    // memory dials are about fitting on the card, not about quality.
    if (setting.type === 'seed' || setting.advanced) continue;

    const current = out[setting.key] ?? setting.default;

    if (setting.key === 'variant' && setting.type === 'select') {
      const wanted = preset === 'detailed' ? 'standard' : preset === 'fast' ? 'turbo' : setting.default;
      if (setting.options?.some((o) => o.value === wanted)) {
        out.variant = wanted as string;
        const steps = model.settings.find((s) => s.key === 'steps');
        if (steps && VARIANT_STEPS[String(wanted)] != null) {
          out.steps = clampNumber(steps, VARIANT_STEPS[String(wanted)]!);
        }
      }
      continue;
    }

    if (preset === 'balanced') {
      out[setting.key] = setting.default;
      continue;
    }

    if (EFFORT_KEYS.has(setting.key) && setting.type === 'number') {
      // Measured from the model's own default, not from an absolute number:
      // 5 steps means something very different on turbo than on standard.
      const base0 = typeof setting.default === 'number' ? setting.default : 0;
      out[setting.key] = clampNumber(setting, preset === 'fast' ? base0 * 0.6 : base0 * 1.75);
      continue;
    }

    if (RESOLUTION_KEYS.has(setting.key)) {
      out[setting.key] = shiftOption(setting, current, preset === 'fast' ? -1 : 1) as number | string | boolean;
      continue;
    }

    out[setting.key] = current as number | string | boolean;
  }

  return out;
}

/**
 * Which preset these settings look like, or null when they match none — a
 * pipeline edited by hand in the node editor is "Custom", and saying so is
 * better than snapping the picker to whichever preset is nearest.
 */
export function detectQuality(
  model: ModelDefinition,
  settings: Record<string, number | string | boolean>
): QualityPreset | null {
  const relevant = model.settings.filter(
    (s) => s.type !== 'seed' && !s.advanced && (EFFORT_KEYS.has(s.key) || RESOLUTION_KEYS.has(s.key) || s.key === 'variant')
  );
  if (relevant.length === 0) return 'balanced';

  for (const preset of ['balanced', 'fast', 'detailed'] as QualityPreset[]) {
    const want = applyQuality(model, preset, settings);
    if (relevant.every((s) => want[s.key] === (settings[s.key] ?? s.default))) return preset;
  }
  return null;
}
