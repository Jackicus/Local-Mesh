import React, { useState } from 'react';
import type { DevicePreference, LocalMeshPaths, PrecisionPreference } from '../../../core/types';
import { getModel } from '../../../core/models';
import { Badge, Button, Card, Form, Modal, toast } from '../../components';
import {
  AlertTriangleIcon,
  CheckIcon,
  CpuIcon,
  FolderOpenIcon,
  GaugeIcon,
  HardDriveIcon,
  MemoryIcon,
  MoonIcon,
  PaletteIcon,
  RefreshIcon,
  StopIcon,
  SunIcon,
  SystemIcon,
  UnplugIcon,
  WorkflowIcon,
} from '../../assets/icons';
import { Disclosure } from '../Models/Disclosure';
import { useTheme, AVAILABLE_ACCENTS } from '../../stores/themeStore';
import { useDockStore, DOCK_DEFAULT_WIDTH } from '../../stores/dockStore';
import { useEnvStore } from '../../stores/envStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useGenerationStore } from '../../stores/generationStore';

const MODE_LABEL = { system: 'System', light: 'Light', dark: 'Dark' } as const;

const WORKER_VARIANT: Record<string, 'neutral' | 'accent' | 'success' | 'warning' | 'danger'> = {
  stopped: 'neutral',
  starting: 'accent',
  idle: 'success',
  loading: 'accent',
  generating: 'accent',
  unloading: 'warning',
  error: 'danger',
};

/** The folders behind the disclosure. Outputs is on the surface instead. */
const ADVANCED_PATHS: Array<{ key: keyof LocalMeshPaths; label: string; fallback: string }> = [
  { key: 'root', label: 'Local Mesh folder', fallback: 'Everything Local Mesh keeps, in one place' },
  { key: 'models', label: 'Models', fallback: 'One downloaded model per folder' },
  { key: 'logs', label: 'Logs', fallback: 'general.log, errors.log, generation.log' },
];

/**
 * One page. The two things a normal person changes sit at the top; everything
 * that needs you to know what VRAM is lives behind the Advanced disclosure.
 */
export const SettingsView: React.FC = () => {
  const [themeState, themeActions] = useTheme();
  const [dockState, dock] = useDockStore();
  const [env] = useEnvStore();
  const [{ settings }, settingsActions] = useSettingsStore();
  const [gen, genActions] = useGenerationStore();
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);

  const activeAccent = AVAILABLE_ACCENTS.find((a) => a.id === themeState.accent);

  const loadedName = gen.loadedModelId ? getModel(gen.loadedModelId)?.name ?? gen.loadedModelId : null;
  const busy = gen.worker === 'generating' || gen.worker === 'loading' || gen.worker === 'unloading';

  const handleConfirmReset = () => {
    localStorage.clear();
    dock.setIsOpen(true);
    dock.setWidth(DOCK_DEFAULT_WIDTH);
    dock.setActiveItem('generate');
    themeActions.reset();
    setIsResetModalOpen(false);
    toast.success('Preferences are back to how they started.');
  };

  return (
    <div className="view-container">
      <header className="view-header">
        <h1 className="view-title">Settings</h1>
        <p className="view-description">
          How Local Mesh looks, and where it saves the meshes you make.
        </p>
      </header>

      <div className="view-list">
        {/* ---------------------------------------------------------------- */}
        {/* Surface: the two things a first-time user actually wants          */}
        {/* ---------------------------------------------------------------- */}
        <Card
          title="Appearance"
          subtitle="How the app looks"
          icon={<PaletteIcon size={20} />}
          action={
            <Badge variant="accent">
              {MODE_LABEL[themeState.mode]} • {activeAccent?.name}
            </Badge>
          }
        >
          <Form.Row label="Theme" description="Light, dark, or whatever the rest of your desktop is using.">
            <Form.Segmented
              value={themeState.mode}
              onChange={themeActions.setMode}
              options={[
                { value: 'system', label: 'System', icon: <SystemIcon size={14} /> },
                { value: 'light', label: 'Light', icon: <SunIcon size={14} /> },
                { value: 'dark', label: 'Dark', icon: <MoonIcon size={14} /> },
              ]}
            />
          </Form.Row>

          <Form.Row label="Accent colour" description="The colour used for buttons, links and anything selected.">
            <div className="accent-square-row">
              {AVAILABLE_ACCENTS.map((accent) => {
                const isSelected = themeState.accent === accent.id;
                return (
                  <button
                    key={accent.id}
                    type="button"
                    className={`accent-square-btn ${isSelected ? 'selected' : ''}`}
                    onClick={() => themeActions.setAccent(accent.id)}
                    style={{ backgroundColor: accent.color }}
                    title={accent.name}
                    aria-label={accent.name}
                  >
                    {isSelected && <CheckIcon size={14} color="#ffffff" strokeWidth={3} />}
                  </button>
                );
              })}
            </div>
          </Form.Row>
        </Card>

        <Card
          title="Your meshes"
          subtitle="Everything you make is saved on this computer, and nowhere else"
          icon={<HardDriveIcon size={20} />}
        >
          <Form.Row
            label="Outputs folder"
            description={
              env.paths ? (
                <span className="settings-path">{env.paths.outputs}</span>
              ) : (
                'Available once Local Mesh has finished starting up.'
              )
            }
          >
            <Button
              size="sm"
              variant="secondary"
              icon={<FolderOpenIcon size={14} />}
              disabled={!env.paths}
              onClick={() => env.paths && window.electronAPI?.openPath(env.paths.outputs)}
            >
              Open folder
            </Button>
          </Form.Row>
        </Card>

        {/* ---------------------------------------------------------------- */}
        {/* Everything else                                                   */}
        {/* ---------------------------------------------------------------- */}
        <Disclosure summary="Advanced" meta="you can ignore all of this">
          <p className="setting-description">
            These settings decide how models run on your graphics card. The defaults are picked for your machine
            and work on their own — come in here only if a model runs out of memory, or you want to trade speed
            for memory on purpose.
          </p>

          <Card title="Tools" subtitle="Extra screens, hidden until you want them" icon={<WorkflowIcon size={20} />}>
            <Form.Row
              label="Show the pipeline editor"
              description="Adds Pipelines to the sidebar: a node graph for changing how a mesh is made, step by step. It appears on its own once you have generated something."
            >
              <Form.Toggle
                checked={dockState.advanced}
                onChange={(v) => dock.setAdvanced(v)}
                aria-label="Show the pipeline editor"
              />
            </Form.Row>
          </Card>

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

          <Card
            title="Other folders"
            subtitle="The rest of what Local Mesh keeps on this machine"
            icon={<FolderOpenIcon size={20} />}
            action={<Badge variant="neutral">{env.paths ? '~/.local-mesh' : 'unavailable'}</Badge>}
          >
            {ADVANCED_PATHS.map((row) => (
              <Form.Row
                key={row.key}
                label={row.label}
                description={
                  env.paths ? <span className="settings-path">{env.paths[row.key]}</span> : row.fallback
                }
              >
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<FolderOpenIcon size={14} />}
                  disabled={!env.paths}
                  onClick={() => env.paths && window.electronAPI?.openPath(env.paths[row.key])}
                >
                  Open
                </Button>
              </Form.Row>
            ))}
          </Card>

          <Card
            title="Start over"
            subtitle="Put this app's own preferences back to their defaults"
            icon={<RefreshIcon size={20} />}
          >
            <Form.Row
              label="Reset preferences"
              description="Sets the theme, accent colour and sidebar back to how they started. Your models and your finished meshes are left alone."
            >
              <Button
                size="sm"
                variant="danger"
                icon={<RefreshIcon size={14} />}
                onClick={() => setIsResetModalOpen(true)}
              >
                Reset
              </Button>
            </Form.Row>
          </Card>
        </Disclosure>
      </div>

      <Modal
        isOpen={isResetModalOpen}
        onClose={() => setIsResetModalOpen(false)}
        title="Reset preferences?"
        subtitle="Nothing you have made is deleted."
        icon={<AlertTriangleIcon size={20} />}
        size="sm"
      >
        <Modal.Body>
          <p>
            The theme, accent colour and sidebar layout go back to their defaults. Your downloaded models and the
            meshes in your outputs folder stay exactly where they are.
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button size="sm" variant="subtle" onClick={() => setIsResetModalOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="danger" icon={<RefreshIcon size={14} />} onClick={handleConfirmReset}>
            Reset
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};
