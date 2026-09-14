import React, { useEffect, useState } from 'react';
import { Button } from '../../components';
import { PowerIcon, UnplugIcon } from '../../assets/icons';
import { useGenerationStore } from '../../stores/generationStore';
import { getModel } from '../../../core/models';
import { DockSection } from './DockSection';
import { formatGb } from './format';

/** Ticks once a second, and only while there is a countdown to draw. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function countdown(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${seconds.toString().padStart(2, '0')}s` : `${seconds}s`;
}

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="gen-kv">
    <span className="gen-kv-key">{label}</span>
    <span className="gen-kv-value">{children}</span>
  </div>
);

/** What the python side is holding, and how to make it let go. */
export const EnginePanel: React.FC = () => {
  const [gen, generation] = useGenerationStore();
  const now = useNow(gen.idleUnloadAt != null);
  const { vramUsedBytes, vramTotalBytes } = gen.memory;

  return (
    <DockSection title="Engine" collapsible defaultOpen={false} meta={gen.worker}>
      <Row label="Model">
        {gen.loadedModelId ? getModel(gen.loadedModelId)?.name ?? gen.loadedModelId : 'Nothing loaded'}
      </Row>
      <Row label="VRAM">
        {vramTotalBytes ? `${formatGb(vramUsedBytes)} / ${formatGb(vramTotalBytes)} GB` : 'Unknown'}
      </Row>
      <Row label="Device">
        {gen.device} · {gen.precision}
      </Row>
      {gen.idleUnloadAt != null && (
        <Row label="Idle">unloads in {countdown(gen.idleUnloadAt - now)}</Row>
      )}
      {gen.workerError && <p className="gen-job-error">{gen.workerError}</p>}

      <div className="ui-btn-row">
        <Button
          variant="secondary"
          size="sm"
          icon={<UnplugIcon size={13} />}
          disabled={!gen.loadedModelId}
          onClick={() => generation.unloadModel()}
        >
          Unload
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<PowerIcon size={13} />}
          disabled={gen.worker === 'stopped'}
          onClick={() => generation.stopWorker()}
        >
          Stop
        </Button>
      </div>
    </DockSection>
  );
};
