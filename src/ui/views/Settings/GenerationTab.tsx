import React from 'react';
import type { DevicePreference, PrecisionPreference } from '../../../core/types';
import { getModel } from '../../../core/models';
import { Badge, Button, Card, Form } from '../../components';
import { CpuIcon, GaugeIcon, MemoryIcon, StopIcon, UnplugIcon } from '../../assets/icons';
import { useSettingsStore } from '../../stores/settingsStore';
import { useGenerationStore } from '../../stores/generationStore';

const WORKER_VARIANT: Record<string, 'neutral' | 'accent' | 'success' | 'warning' | 'danger'> = {
  stopped: 'neutral',
  starting: 'accent',
  idle: 'success',
  loading: 'accent',
  generating: 'accent',
  unloading: 'warning',
  error: 'danger',
};

export const GenerationTab: React.FC = () => {
  const [{ settings }, settingsActions] = useSettingsStore();
  const [gen, genActions] = useGenerationStore();

  const loadedName = gen.loadedModelId ? getModel(gen.loadedModelId)?.name ?? gen.loadedModelId : null;
  const busy = gen.worker === 'generating' || gen.worker === 'loading' || gen.worker === 'unloading';

  return (
    <div className="view-list">
      <Card
        title="Model lifecycle"
        subtitle="When to free the GPU between jobs"
        icon={<MemoryIcon size={20} />}
      >
        <Form.Row
          label="Idle unload"
          description="Unload the model after this long without a job. Loading again takes 10-60 s depending on the model."
        >
          <Form.Slider
            min={0}
            max={60}
            step={1}
            value={settings.idleUnloadMinutes}
            onChange={(v) => void settingsActions.update({ idleUnloadMinutes: v })}
            showValue={false}
            aria-label="Idle unload minutes"
          />
          <span className="ui-slider-value">
            {settings.idleUnloadMinutes === 0 ? 'never' : `${settings.idleUnloadMinutes} min`}
          </span>
        </Form.Row>
        <Form.Row
          label="Stop worker when idle"
          description="Also exit the python process on idle unload, releasing all VRAM and RAM. The next job pays the ~5 s startup again."
        >
          <Form.Toggle
            checked={settings.stopWorkerWhenIdle}
            onChange={(v) => void settingsActions.update({ stopWorkerWhenIdle: v })}
            aria-label="Stop worker when idle"
          />
        </Form.Row>
      </Card>

      <Card title="Compute" subtitle="Device and numeric precision for every model" icon={<GaugeIcon size={20} />}>
        <Form.Row label="Device" description="Auto uses CUDA when torch can see the GPU and falls back to CPU otherwise.">
          <Form.Segmented<DevicePreference>
            value={settings.device}
            onChange={(v) => void settingsActions.update({ device: v })}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'cuda', label: 'CUDA' },
              { value: 'cpu', label: 'CPU' },
            ]}
          />
        </Form.Row>
        <Form.Row
          label="Precision"
          description="Auto picks fp32 compute on Pascal cards (GTX 10xx: no bf16, slow fp16) and fp16 on newer GPUs. fp16 halves VRAM where the kernels are fast."
        >
          <Form.Segmented<PrecisionPreference>
            value={settings.precision}
            onChange={(v) => void settingsActions.update({ precision: v })}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'fp16', label: 'fp16' },
              { value: 'fp32', label: 'fp32' },
            ]}
          />
        </Form.Row>
        <Form.Row
          label="Low VRAM mode"
          description="Keeps conditioners on the CPU and decodes in smaller chunks. Slower, but the difference between fitting and OOM on 8 GB."
        >
          <Form.Toggle
            checked={settings.lowVram}
            onChange={(v) => void settingsActions.update({ lowVram: v })}
            aria-label="Low VRAM mode"
          />
        </Form.Row>
      </Card>

      <Card
        title="Worker"
        subtitle="The python process that runs the models"
        icon={<CpuIcon size={20} />}
        action={<Badge variant={WORKER_VARIANT[gen.worker] ?? 'neutral'}>{gen.worker}</Badge>}
      >
        <Form.Row
          label="Loaded model"
          description={
            gen.workerError
              ? gen.workerError
              : loadedName
                ? `${loadedName} on ${gen.device} / ${gen.precision}`
                : gen.loadingModelId
                  ? `Loading ${getModel(gen.loadingModelId)?.name ?? gen.loadingModelId}…`
                  : 'Nothing loaded'
          }
        >
          <Button
            size="sm"
            variant="secondary"
            icon={<StopIcon size={14} />}
            disabled={!gen.loadedModelId || busy}
            onClick={() => void genActions.unloadModel()}
          >
            Unload
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={<UnplugIcon size={14} />}
            disabled={gen.worker === 'stopped'}
            onClick={() => void genActions.stopWorker()}
          >
            Stop
          </Button>
        </Form.Row>
      </Card>
    </div>
  );
};
