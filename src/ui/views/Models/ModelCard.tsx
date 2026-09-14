import React, { useState } from 'react';
import type { ModelDefinition, ModelDownloadProgress, ModelInstallState } from '../../../core/types';
import { Badge, Button, Card, Modal, Tooltip } from '../../components';
import {
  AlertTriangleIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  PackageIcon,
  PlayIcon,
  StopIcon,
  TrashIcon,
} from '../../assets/icons';
import { formatBytes, formatGb, gbToBytes } from './formatBytes';
import { ModelStep, type StepBadge } from './ModelStep';

interface ModelCardProps {
  model: ModelDefinition;
  install?: ModelInstallState;
  download?: ModelDownloadProgress;
  envReady: boolean;
  vramTotalBytes: number | null;
  loaded: boolean;
  /** A job is running or a model is loading: no load/unload allowed. */
  busy: boolean;
  onDownload: () => void;
  onInstallDeps: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onLoad: () => void;
  onUnload: () => void;
}

const TAG_VARIANT: Record<string, 'accent' | 'warning' | 'neutral'> = {
  recommended: 'accent',
  experimental: 'warning',
};

const WEIGHTS_BADGE: Record<string, StepBadge> = {
  none: { variant: 'neutral', label: 'not downloaded' },
  partial: { variant: 'warning', label: 'partial' },
  complete: { variant: 'success', label: 'downloaded' },
};

const DEPS_BADGE: Record<string, StepBadge> = {
  unknown: { variant: 'neutral', label: 'unknown' },
  missing: { variant: 'neutral', label: 'missing' },
  installed: { variant: 'success', label: 'installed' },
};

const BUILT_IN: StepBadge = { variant: 'success', label: 'built in' };

function fit(vramGb: number, total: number | null) {
  if (vramGb <= 0 || total == null) return null;
  const need = gbToBytes(vramGb);
  const of = `needs ~${vramGb} GB of ${formatGb(total)} VRAM`;
  if (need <= total * 0.8) return { variant: 'success' as const, label: 'fits', title: of };
  if (need <= total) return { variant: 'warning' as const, label: 'tight', title: of };
  return { variant: 'danger' as const, label: 'exceeds', title: of };
}

interface IconActionProps {
  label: string;
  icon: React.ReactNode;
  variant?: 'subtle' | 'danger';
  disabled?: boolean;
  onClick: () => void;
}

/** Footer utilities carry their name in a tooltip so only the primary action is labelled. */
const IconAction: React.FC<IconActionProps> = ({ label, icon, variant = 'subtle', disabled, onClick }) => (
  <Tooltip content={label}>
    <Button size="sm" variant={variant} className="btn-icon-only" icon={icon} aria-label={label} disabled={disabled} onClick={onClick} />
  </Tooltip>
);

export const ModelCard: React.FC<ModelCardProps> = ({
  model,
  install,
  download,
  envReady,
  vramTotalBytes,
  loaded,
  busy,
  onDownload,
  onInstallDeps,
  onCancel,
  onDelete,
  onLoad,
  onUnload,
}) => {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isMock = model.id === 'mock';
  const running = Boolean(
    download &&
      (download.status === 'starting' || download.status === 'downloading' || download.status === 'installing-deps')
  );
  const weights = install?.weights ?? 'none';
  const deps = install?.deps ?? 'unknown';
  const ready = isMock || install?.ready === true;
  const hasFiles = weights !== 'none';
  const fitState = fit(model.vramGb, vramTotalBytes);

  const specs = [
    model.params !== '0' ? model.params : null,
    model.vramGb > 0 ? `~${model.vramGb} GB VRAM` : null,
    model.diskGb > 0 ? `${model.diskGb} GB disk` : null,
    model.license,
    model.releaseDate,
  ].filter((s): s is string => Boolean(s));

  const installDepsButton = (
    <Button
      size="sm"
      variant={weights === 'complete' ? 'primary' : 'secondary'}
      icon={<PackageIcon size={14} />}
      disabled={running || !envReady}
      onClick={onInstallDeps}
    >
      Install
    </Button>
  );

  return (
    <Card className="models-card">
      <Card.Header>
        <h3 className="models-card-name" title={model.description}>
          {model.name}
          <span className="models-card-vendor"> · {model.vendor}</span>
        </h3>
        <div className="models-card-marks">
          {model.tags.map((tag) => (
            <Badge key={tag} variant={TAG_VARIANT[tag] ?? 'neutral'} className="models-pill">
              {tag}
            </Badge>
          ))}
          {loaded ? <Badge variant="success">Loaded</Badge> : ready ? <Badge variant="success">Ready</Badge> : null}
        </div>
      </Card.Header>

      <Card.Body>
        <p className="models-description" title={model.description}>
          {model.description}
        </p>

        <div className="models-spec">
          <span className="models-spec-line">{specs.join(' · ')}</span>
          {fitState && (
            <span className="models-fit" title={fitState.title}>
              <Badge variant={fitState.variant} className="models-pill">
                {fitState.label}
              </Badge>
            </span>
          )}
        </div>

        <div className="models-steps">
          <ModelStep
            index={1}
            label="Weights"
            badge={isMock ? BUILT_IN : WEIGHTS_BADGE[weights]}
            aside={!isMock && install && install.sizeBytes > 0 ? formatBytes(install.sizeBytes) : undefined}
            progress={download?.kind === 'weights' ? download : undefined}
            onCancel={onCancel}
            action={
              isMock || weights === 'complete' ? undefined : (
                // Weights come straight from Hugging Face, so the env never gates this.
                <Button size="sm" variant="primary" icon={<DownloadIcon size={14} />} disabled={running} onClick={onDownload}>
                  {weights === 'partial' ? 'Resume' : 'Download'}
                </Button>
              )
            }
            note={isMock ? 'Procedural: nothing to fetch.' : `Downloads ${model.hfRepo} from Hugging Face. No Python needed.`}
          />
          <ModelStep
            index={2}
            label="Deps"
            badge={isMock ? BUILT_IN : DEPS_BADGE[deps]}
            progress={download?.kind === 'deps' ? download : undefined}
            onCancel={onCancel}
            action={
              isMock || deps === 'installed' ? undefined : envReady ? (
                installDepsButton
              ) : (
                <Tooltip content="Set up the environment first">{installDepsButton}</Tooltip>
              )
            }
            note={
              isMock
                ? 'Runs on the base environment.'
                : model.requirements
                  ? `Clones the upstream repo and installs ${model.requirements} into the shared virtualenv.`
                  : 'Runs on the base environment; no extra packages.'
            }
          />
        </div>
      </Card.Body>

      <Card.Footer>
        {model.homepage && (
          <IconAction
            label="Hugging Face"
            icon={<ExternalLinkIcon size={15} />}
            onClick={() => window.electronAPI?.openExternal(model.homepage)}
          />
        )}
        {install && hasFiles && (
          <IconAction
            label="Open folder"
            icon={<FolderOpenIcon size={15} />}
            onClick={() => window.electronAPI?.openPath(install.dir)}
          />
        )}
        {hasFiles && !running && (
          <IconAction
            label={loaded ? 'Unload before deleting' : 'Delete weights'}
            icon={<TrashIcon size={15} />}
            variant="danger"
            disabled={loaded}
            onClick={() => setConfirmDelete(true)}
          />
        )}
        {ready &&
          (loaded ? (
            <Button size="sm" variant="secondary" icon={<StopIcon size={14} />} disabled={busy} onClick={onUnload}>
              Unload
            </Button>
          ) : (
            <Button size="sm" variant="primary" icon={<PlayIcon size={14} />} disabled={busy || !envReady} onClick={onLoad}>
              Load now
            </Button>
          ))}
      </Card.Footer>

      <Modal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${model.name}?`}
        subtitle={`Removes ${formatBytes(install?.sizeBytes)} of weights from disk.`}
        icon={<AlertTriangleIcon size={20} />}
        size="sm"
      >
        <Modal.Body>
          <p>The weights can be downloaded again later; the Python dependencies stay installed.</p>
        </Modal.Body>
        <Modal.Footer>
          <Button size="sm" variant="subtle" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={<TrashIcon size={14} />}
            onClick={() => {
              setConfirmDelete(false);
              onDelete();
            }}
          >
            Delete
          </Button>
        </Modal.Footer>
      </Modal>
    </Card>
  );
};
