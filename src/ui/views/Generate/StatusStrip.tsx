import React from 'react';
import type { GenerationStoreState } from '../../stores/generationStore';
import { useGenerationStore } from '../../stores/generationStore';
import { useStore } from '../../stores/createStore';
import { viewerStore } from './viewerStore';
import { getModel } from '../../../core/models';
import { ProgressBar } from './ProgressBar';
import { ElapsedTime } from './ElapsedTime';
import { formatGb } from './format';

type Tone = 'muted' | 'accent' | 'success' | 'warning' | 'danger';

function modelName(id: string | null): string {
  if (!id) return 'nothing';
  return getModel(id)?.name ?? id;
}

function workerLabel(state: GenerationStoreState): { text: string; tone: Tone } {
  switch (state.worker) {
    case 'starting':
      return { text: 'Starting', tone: 'warning' };
    case 'idle':
      return { text: 'Idle', tone: 'success' };
    case 'loading':
      return { text: `Loading ${modelName(state.loadingModelId)}`, tone: 'warning' };
    case 'generating':
      return { text: 'Generating', tone: 'accent' };
    case 'processing':
      return { text: 'Processing', tone: 'accent' };
    case 'unloading':
      return { text: 'Unloading', tone: 'warning' };
    case 'error':
      return { text: 'Worker error', tone: 'danger' };
    default:
      return { text: 'Stopped', tone: 'muted' };
  }
}

/** The instrument reading for the python side: worker, weights, VRAM, job. */
export const StatusStrip: React.FC = () => {
  const [gen] = useGenerationStore();
  const status = workerLabel(gen);
  const active = gen.jobs.find((j) => j.id === gen.activeJobId) ?? null;
  const processing = gen.processing;
  const toolBusy = useStore(viewerStore).toolBusy;
  const { vramUsedBytes, vramTotalBytes } = gen.memory;
  const vramPct =
    vramUsedBytes != null && vramTotalBytes ? (vramUsedBytes / vramTotalBytes) * 100 : null;

  return (
    <div className="gen-status">
      <div className="gen-status-line">
        <span className={`gen-dot gen-dot-${status.tone}`} aria-hidden="true" />
        <span className="gen-status-label">{status.text}</span>
        <span className="gen-status-sep" />
        <span className="gen-status-model" title={gen.workerError ?? undefined}>
          {gen.loadedModelId ? modelName(gen.loadedModelId) : 'No model loaded'}
        </span>
      </div>

      {vramPct != null && (
        <div className="gen-status-vram">
          <span className="gen-status-label">VRAM</span>
          <ProgressBar pct={vramPct} tone={vramPct > 92 ? 'danger' : vramPct > 75 ? 'warning' : 'accent'} />
          <span className="gen-status-value">
            {formatGb(vramUsedBytes)}/{formatGb(vramTotalBytes)} GB
          </span>
        </div>
      )}

      {active && (active.status === 'running' || active.status === 'loading') && (
        <div className="gen-status-job">
          <div className="gen-status-line">
            <span className="gen-status-label">{active.progress.stage || active.status}</span>
            <ElapsedTime
              since={active.startedAt ?? active.createdAt}
              className="gen-status-value"
              title="Elapsed"
            />
            <span className="gen-status-sep" />
            <span className="gen-status-value">{Math.round(active.progress.pct)}%</span>
          </div>
          <ProgressBar pct={active.progress.pct} indeterminate={active.status === 'loading'} />
          <span className="gen-status-message">{active.progress.message || active.imageName}</span>
        </div>
      )}

      {(processing || toolBusy) && (
        <div className="gen-status-job">
          <div className="gen-status-line">
            <span className="gen-status-label">
              Processing{processing?.stage ? ` · ${processing.stage}` : toolBusy ? ` · ${toolBusy}` : ''}
            </span>
            {processing && <ElapsedTime since={processing.startedAt} className="gen-status-value" />}
            <span className="gen-status-sep" />
            {processing && (
              <span className="gen-status-value">{Math.round(processing.pct)}%</span>
            )}
          </div>
          <ProgressBar pct={processing?.pct ?? 0} indeterminate={!processing} />
          {processing?.message && (
            <span className="gen-status-message">{processing.message}</span>
          )}
        </div>
      )}
    </div>
  );
};
