import React, { useEffect } from 'react';
import { MODELS } from '../../../core/models';
import { Badge, Button, toast } from '../../components';
import { FolderOpenIcon, HardDriveIcon, PackageIcon } from '../../assets/icons';
import { useEnvStore } from '../../stores/envStore';
import { useModelStore } from '../../stores/modelStore';
import { useGenerationStore } from '../../stores/generationStore';
import { EnvironmentCard } from './EnvironmentCard';
import { ModelCard } from './ModelCard';
import { formatBytes } from './formatBytes';

export const ModelsView: React.FC = () => {
  const [env, envActions] = useEnvStore();
  const [models, modelActions] = useModelStore();
  const [gen, genActions] = useGenerationStore();

  // Re-probe on every visit: uv may have been installed, or weights changed on
  // disk, since the stores bound at startup.
  useEffect(() => {
    void envActions.refresh();
    void modelActions.refresh();
  }, [envActions, modelActions]);

  const envReady = env.status?.ready ?? false;
  const busy = gen.activeJobId !== null || gen.worker === 'loading' || gen.worker === 'generating' || gen.worker === 'unloading';
  const totalBytes = Object.values(models.installs).reduce((sum, m) => sum + (m.sizeBytes || 0), 0);

  return (
    <div className="view-container">
      <header className="view-header">
        <Badge variant="accent" icon={<PackageIcon size={14} />}>
          Environment &amp; weights
        </Badge>
        <h1 className="view-title">Models</h1>
        <p className="view-description">
          Weights download straight from Hugging Face; the Python environment runs them and holds each model&apos;s
          dependencies. Everything lives under{' '}
          <code className="models-inline-code">{env.paths?.root ?? '~/.local-mesh'}</code>.
        </p>
      </header>

      <EnvironmentCard />

      <div className="view-grid models-grid">
        {MODELS.map((model) => (
          <ModelCard
            key={model.id}
            model={model}
            install={models.installs[model.id]}
            download={models.downloads[model.id]}
            envReady={envReady}
            vramTotalBytes={env.status?.vramTotalBytes ?? gen.memory.vramTotalBytes}
            loaded={gen.loadedModelId === model.id}
            busy={busy}
            onDownload={() => void modelActions.download(model.id)}
            onInstallDeps={() => void modelActions.installDeps(model.id)}
            onCancel={() => void modelActions.cancelDownload(model.id)}
            onDelete={async () => {
              await modelActions.remove(model.id);
              toast.success(`${model.name} deleted`);
            }}
            onLoad={() => void genActions.loadModel(model.id)}
            onUnload={() => void genActions.unloadModel()}
          />
        ))}
      </div>

      <footer className="models-storage">
        <HardDriveIcon size={14} />
        <span className="models-storage-label">Storage</span>
        <span className="models-storage-value">
          {formatBytes(totalBytes)} in <code className="models-inline-code">{env.paths?.models ?? '~/.local-mesh/models'}</code>
        </span>
        {env.paths && (
          <Button size="sm" variant="subtle" icon={<FolderOpenIcon size={14} />} onClick={() => window.electronAPI?.openPath(env.paths!.models)}>
            Open folder
          </Button>
        )}
      </footer>
    </div>
  );
};
