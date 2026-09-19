import React, { useEffect, useState } from 'react';
import type { ModelDefinition, ModelInstallState } from '../../../core/types';
import { Button, Modal, Tooltip } from '../../components';
import {
  AlertTriangleIcon,
  CancelIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  PlayIcon,
  RefreshIcon,
  StopIcon,
  TrashIcon,
  WrenchIcon,
} from '../../assets/icons';
import { formatBytes } from './formatBytes';
import type { ActionKind, ModelState } from './modelState';

export interface ModelHandlers {
  /** Runs every outstanding leg — engine, weights, packages — as one action. */
  onInstall: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onLoad: () => void;
  onUnload: () => void;
  /** Show the one prerequisite the app cannot install for you. */
  onFixEngine: () => void;
}

const ACTION_ICON = {
  install: <DownloadIcon size={14} />,
  retry: <RefreshIcon size={14} />,
  cancel: <CancelIcon size={14} />,
};

/** The one button that matters on a model: whatever comes next, and nothing else. */
export const PrimaryAction: React.FC<{
  state: ModelState;
  handlers: ModelHandlers;
  size?: 'sm' | 'md';
}> = ({ state, handlers, size = 'sm' }) => {
  const { action } = state;
  // Main gives a model one run slot and throws for the second claim, so a
  // second click before the first progress event lands is a guaranteed error
  // toast. Lock the button optimistically and let the state machine unlock it:
  // any answer from main changes `action.kind` (Download -> Stop -> Try again).
  const [pending, setPending] = useState<ActionKind | null>(null);
  const kind = action?.kind ?? null;

  useEffect(() => {
    if (pending === null) return;
    if (kind !== pending) {
      setPending(null);
      return;
    }
    // Nothing came back. Unlock rather than stranding the only button there is.
    const timer = setTimeout(() => setPending(null), 8000);
    return () => clearTimeout(timer);
  }, [pending, kind]);

  if (!action) return null;
  const run = action.kind === 'cancel' ? handlers.onCancel : handlers.onInstall;
  return (
    <Button
      size={size}
      className="models-primary"
      variant={action.kind === 'cancel' ? 'secondary' : 'primary'}
      icon={ACTION_ICON[action.kind]}
      disabled={pending === action.kind}
      onClick={() => {
        setPending(action.kind);
        run();
      }}
    >
      {action.label}
    </Button>
  );
};

/** Why nothing can happen yet, and the way out of it when there is one. */
export const BlockedNote: React.FC<{ reason: string; onFix?: () => void }> = ({ reason, onFix }) => (
  <p className="models-blocked">
    <WrenchIcon size={14} />
    <span>{reason}</span>
    {onFix && (
      <button type="button" className="models-link" onClick={onFix}>
        Show me how
      </button>
    )}
  </p>
);

const IconAction: React.FC<{
  label: string;
  icon: React.ReactNode;
  variant?: 'subtle' | 'danger';
  disabled?: boolean;
  onClick: () => void;
}> = ({ label, icon, variant = 'subtle', disabled, onClick }) => (
  <Tooltip content={label}>
    <Button
      size="sm"
      variant={variant}
      className="btn-icon-only"
      icon={icon}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    />
  </Tooltip>
);

/**
 * Everything that is not the next step: keeping the model warm in memory,
 * opening its folder, reading about it upstream, throwing the files away.
 */
export const ModelUtilities: React.FC<{
  model: ModelDefinition;
  install?: ModelInstallState;
  state: ModelState;
  loaded: boolean;
  busy: boolean;
  handlers: ModelHandlers;
  /** Drop the destructive and expert bits — for the promoted card, where the
      only sensible next move is Install and a red button beside it is a trap. */
  minimal?: boolean;
}> = ({ model, install, state, loaded, busy, handlers, minimal = false }) => {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const hasFiles = (install?.weights ?? 'none') !== 'none';

  return (
    <>
      {model.homepage && (
        <IconAction
          label="Read about it on the web"
          icon={<ExternalLinkIcon size={15} />}
          onClick={() => window.electronAPI?.openExternal(model.homepage)}
        />
      )}
      {install && hasFiles && (
        <IconAction
          label="Open its folder"
          icon={<FolderOpenIcon size={15} />}
          onClick={() => window.electronAPI?.openPath(install.dir)}
        />
      )}
      {hasFiles && !state.running && !minimal && (
        <IconAction
          label={loaded ? 'Unload it before deleting' : `Delete the files (${formatBytes(install?.sizeBytes)})`}
          icon={<TrashIcon size={15} />}
          variant="danger"
          disabled={loaded}
          onClick={() => setConfirmDelete(true)}
        />
      )}
      {state.ready &&
        !minimal &&
        (loaded ? (
          <Tooltip content="Frees the graphics memory it is holding">
            <Button size="sm" variant="secondary" icon={<StopIcon size={14} />} disabled={busy} onClick={handlers.onUnload}>
              Unload
            </Button>
          </Tooltip>
        ) : (
          <Tooltip content="Loads it into graphics memory now. Generating does this for you anyway.">
            <Button size="sm" variant="subtle" icon={<PlayIcon size={14} />} disabled={busy} onClick={handlers.onLoad}>
              Load now
            </Button>
          </Tooltip>
        ))}

      <Modal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${model.name}'s files?`}
        subtitle={`Frees ${formatBytes(install?.sizeBytes)} of disk space.`}
        icon={<AlertTriangleIcon size={20} />}
        size="sm"
      >
        <Modal.Body>
          <p>You can download them again at any time, and the extra packages it installed stay where they are.</p>
        </Modal.Body>
        <Modal.Footer>
          <Button size="sm" variant="subtle" onClick={() => setConfirmDelete(false)}>
            Keep them
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={<TrashIcon size={14} />}
            onClick={() => {
              setConfirmDelete(false);
              handlers.onDelete();
            }}
          >
            Delete
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};
