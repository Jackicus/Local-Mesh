import React from 'react';
import { LoaderIcon } from '../assets/icons';
import { getModel } from '../../core/models';
import type { GenerationStoreState } from '../stores/generationStore';
import { useGenerationStore } from '../stores/generationStore';

type Tone = 'accent' | 'success' | 'danger';

interface Readout {
  tone: Tone;
  /** Spinner rather than a dot — the worker is mid-task. */
  busy: boolean;
  text: string;
  /** Quiet second line: the model in flight, or the raw error behind the plain one. */
  detail: string | null;
}

function modelName(id: string | null): string | null {
  if (!id) return null;
  return getModel(id)?.name ?? id;
}

/**
 * What to say, in words a first-time user can act on. Anything that isn't the
 * worker actually doing something (or failing at it) reads as `null` — the
 * resting state of the python side is silence, not a status line.
 */
function readout(gen: GenerationStoreState): Readout | null {
  const model = modelName(gen.loadedModelId) ?? modelName(gen.loadingModelId);

  switch (gen.worker) {
    case 'starting':
    case 'loading':
      return { tone: 'accent', busy: true, text: 'Getting ready…', detail: model };
    case 'generating':
    case 'processing':
      return { tone: 'accent', busy: true, text: 'Working…', detail: model };
    case 'unloading':
      return { tone: 'accent', busy: true, text: 'Finishing up…', detail: model };
    case 'error':
      return { tone: 'danger', busy: false, text: 'Something went wrong', detail: gen.workerError };
    default:
      // 'idle' and 'stopped': a loaded model is worth one quiet line, nothing else is.
      return model ? { tone: 'success', busy: false, text: `${model} ready`, detail: null } : null;
  }
}

/**
 * The python side, as a dock item — but only when it has something to say.
 * At rest it renders nothing: "stopped" is how the worker spends most of its
 * life, and a beginner reading that as a fault is worse than no readout at all.
 * The expert controls (unload, stop) live in Settings.
 */
export const EngineItem: React.FC = () => {
  const [gen] = useGenerationStore();
  const state = readout(gen);
  if (!state) return null;

  return (
    <section className={`dock-engine is-${state.tone}`} aria-label="Engine" aria-live="polite">
      <p className="dock-engine-line" title={state.detail ?? undefined}>
        <span className="dock-engine-mark" aria-hidden="true">
          {state.busy ? <LoaderIcon size={14} className="dock-engine-spin" /> : <span className="dock-engine-dot" />}
        </span>
        <span className="dock-engine-text">{state.text}</span>
      </p>
      {state.detail && <p className="dock-engine-detail">{state.detail}</p>}
    </section>
  );
};
