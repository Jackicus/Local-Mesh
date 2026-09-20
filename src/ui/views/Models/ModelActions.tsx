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
import type { ActionKind, ModelAction, ModelState } from './modelState';

export interface ModelHandlers {
  /** Fetch the weights. Needs nothing installed and contends with nothing. */
  onGetFiles: () => void;
  onCancelFiles: () => void;
  /** The shared engine and this model's own packages, as one press. */
  onSetUp: () => void;
  onCancelSetup: () => void;
  onDelete: () => void;
  onLoad: () => void;
  onUnload: () => void;
  /** Show the one prerequisite the app cannot install for you. */
  onFixEngine: () => void;
}

const ACTION_ICON: Record<ActionKind, React.ReactNode> = {
  install: <DownloadIcon size={14} />,
  retry: <RefreshIcon size={14} />,
  cancel: <CancelIcon size={14} />,
};

/**
 * One of the two buttons.
 *
 * Main gives a model one run slot and throws for the second claim, so a second
 * click before the first progress event lands is a guaranteed error toast.
 * Lock the button optimistically and let the state machine unlock it: any
 * answer from main changes `action.kind` (Get -> Stop -> Try again).
 */
const ActionButton: React.FC<{
  action: ModelAction | null;
  icon?: React.ReactNode;
  variant?: 'primary' | 'secondary';
  size: 'sm' | 'md';
  onRun: () => void;
  onCancel: () => void;
}> = ({ action, icon, variant = 'primary', size, onRun, onCancel }) => {
  const [pending, setPending] = useState<ActionKind | null>(null);
  const kind = action?.kind ?? null;

  useEffect(() => {
    if (pending === null) return;
    if (kind !== pending) {
      setPending(null);
      return;
    }
    // Nothing came back. Unlock rather than stranding the button.
    const timer = setTimeout(() => setPending(null), 8000);
    return () => clearTimeout(timer);
  }, [pending, kind]);

  if (!action) return null;
  const cancelling = action.kind === 'cancel';
  return (
    <Button
      size={size}
      variant={cancelling ? 'secondary' : variant}
      icon={cancelling ? ACTION_ICON.cancel : (icon ?? ACTION_ICON[action.kind])}
      disabled={pending === action.kind}
      onClick={() => {
        setPending(action.kind);
        (cancelling ? onCancel : onRun)();
      }}
    >
      {action.label}
    </Button>
  );
};

/**
 * The two things a model asks for, side by side: the files it is, and the
 * setup that makes it runnable. They are separate buttons because they are
 * separate concepts — the download works on a machine with no Python on it at
 * all, and the setup is shared groundwork that only one model may build at a
 * time. Either may be absent, which simply means that half is already done.
 */
export const InstallActions: React.FC<{
  state: ModelState;
  handlers: ModelHandlers;
  size?: 'sm' | 'md';
}> = ({ state, handlers, size = 'sm' }) => {
  if (!state.filesAction && !state.runtimeAction) return null;
  return (
    <div className="models-actions">
      <ActionButton
        action={state.filesAction}
        size={size}
        onRun={handlers.onGetFiles}
        onCancel={handlers.onCancelFiles}
      />
      <ActionButton
        action={state.runtimeAction}
        icon={<WrenchIcon size={14} />}
        // Never two primaries: whichever half is outstanding alone is the next
        // thing to press, and when both are, the files come first.
        variant={state.filesAction ? 'secondary' : 'primary'}
        size={size}
        onRun={handlers.onSetUp}
        onCancel={handlers.onCancelSetup}
      />
    </div>
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
}> = ({ model, install, state, loaded, busy, handlers }) => {
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
      {hasFiles && !state.running && (
        <IconAction
          label={loaded ? 'Unload it before deleting' : `Delete the files (${formatBytes(install?.sizeBytes)})`}
          icon={<TrashIcon size={15} />}
          variant="danger"
          disabled={loaded}
          onClick={() => setConfirmDelete(true)}
        />
      )}
      {state.ready &&
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
