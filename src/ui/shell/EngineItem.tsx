import React from 'react';
import { CpuIcon, PowerIcon, UnplugIcon } from '../assets/icons';
import { Tooltip } from '../components';
import { useNow } from '../hooks';
import { getModel } from '../../core/models';
import type { GenerationStoreState } from '../stores/generationStore';
import { useGenerationStore } from '../stores/generationStore';

type Tone = 'muted' | 'accent' | 'success' | 'warning' | 'danger';

function modelName(id: string | null): string | null {
  if (!id) return null;
  return getModel(id)?.name ?? id;
}

function engineState(state: GenerationStoreState): { text: string; tone: Tone } {
  switch (state.worker) {
    case 'starting':
      return { text: 'Starting', tone: 'warning' };
    case 'idle':
      return { text: 'Idle', tone: 'success' };
    case 'loading':
      return { text: 'Loading', tone: 'warning' };
    case 'generating':
      return { text: 'Generating', tone: 'accent' };
    case 'processing':
      return { text: 'Processing', tone: 'accent' };
    case 'unloading':
      return { text: 'Unloading', tone: 'warning' };
    case 'error':
      return { text: 'Error', tone: 'danger' };
    default:
      return { text: 'Stopped', tone: 'muted' };
  }
}

function countdown(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${seconds.toString().padStart(2, '0')}s` : `${seconds}s`;
}

function gb(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  return (bytes / 1024 ** 3).toFixed(1);
}

/** Its own component so the shared second-ticker only runs while a countdown is on screen. */
const IdleCountdown: React.FC<{ until: number }> = ({ until }) => {
  const now = useNow(1000);
  return <span> · unloads in {countdown(until - now)}</span>;
};

/**
 * The python side, as a dock item. It sits above Logs because it is the same
 * kind of thing: a standing readout of what the app is doing off-screen, with
 * the one control that readout implies — letting go of the weights.
 */
export const EngineItem: React.FC = () => {
  const [gen, generation] = useGenerationStore();
  const state = engineState(gen);
  const loaded = modelName(gen.loadedModelId) ?? modelName(gen.loadingModelId);
  const { vramUsedBytes, vramTotalBytes } = gen.memory;
  const vramPct = vramUsedBytes != null && vramTotalBytes ? (vramUsedBytes / vramTotalBytes) * 100 : null;
  const resting = gen.worker === 'stopped' && !gen.loadedModelId;

  return (
    <section className="dock-engine" aria-label="Engine">
      <div className="dock-engine-head">
        <span className="dock-item-icon">
          <CpuIcon size={20} />
        </span>
        <span className="dock-engine-title">Engine</span>
        <span className={`dock-engine-state is-${state.tone}`}>
          <span className="dock-engine-dot" aria-hidden="true" />
          {state.text}
        </span>
      </div>

      {!resting && (
        <div className="dock-engine-body">
          <p className="dock-engine-model" title={loaded ?? undefined}>
            {loaded ?? 'No model loaded'}
          </p>

          {vramPct != null && (
            <div className="dock-meter" role="img" aria-label={`VRAM ${gb(vramUsedBytes)} of ${gb(vramTotalBytes)} gigabytes`}>
              <span className={`dock-meter-track ${vramPct > 92 ? 'is-danger' : vramPct > 75 ? 'is-warning' : ''}`}>
                <span className="dock-meter-fill" style={{ width: `${Math.min(100, vramPct)}%` }} />
              </span>
              <span className="dock-meter-figure">
                {gb(vramUsedBytes)}/{gb(vramTotalBytes)} GB
              </span>
            </div>
          )}

          <p className="dock-engine-meta">
            {gen.device} · {gen.precision}
            {gen.idleUnloadAt != null && <IdleCountdown until={gen.idleUnloadAt} />}
          </p>

          {gen.workerError && <p className="dock-engine-error">{gen.workerError}</p>}

          <div className="dock-engine-actions">
            <button
              type="button"
              className="dock-engine-btn"
              disabled={!gen.loadedModelId}
              onClick={() => void generation.unloadModel()}
            >
              <UnplugIcon size={13} />
              Unload
            </button>
            <Tooltip content="Stop the python worker" position="top">
              <button
                type="button"
                className="dock-engine-btn is-icon"
                aria-label="Stop the python worker"
                disabled={gen.worker === 'stopped'}
                onClick={() => void generation.stopWorker()}
              >
                <PowerIcon size={13} />
              </button>
            </Tooltip>
          </div>
        </div>
      )}
    </section>
  );
};
