import React, { useState } from 'react';
import type { EnvPhase } from '../../../core/types';
import { Badge, Button, Card, Modal, toast } from '../../components';
import {
  AlertTriangleIcon,
  CancelIcon,
  CopyIcon,
  FolderOpenIcon,
  InfoIcon,
  LoaderIcon,
  TrashIcon,
  WrenchIcon,
} from '../../assets/icons';
import { useEnvStore } from '../../stores/envStore';
import { ProgressBar } from './ProgressBar';
import { SetupLog } from './SetupLog';
import { formatGb } from './formatBytes';

const UV_INSTALL = 'curl -LsSf https://astral.sh/uv/install.sh | sh';
const PASCAL = /GTX 10|Pascal|P100|Titan X/i;

/** Phases main only reports while a setup is actually running (never on a status poll). */
const SETUP_PHASES: EnvPhase[] = ['creating-venv', 'installing-torch', 'installing-base', 'verifying'];

const PHASE_LABEL: Record<string, string> = {
  checking: 'Checking',
  'creating-venv': 'Creating virtualenv',
  'installing-torch': 'Installing torch (cu126)',
  'installing-base': 'Installing base requirements',
  verifying: 'Verifying imports',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

interface FieldProps {
  label: string;
  /** Full text for the tooltip when the value is truncated. */
  title?: string;
  /** Spans both columns — used by the GPU line, which is the longest. */
  wide?: boolean;
  children: React.ReactNode;
}

const Field: React.FC<FieldProps> = ({ label, title, wide, children }) => (
  <div className={`models-env-field ${wide ? 'wide' : ''}`}>
    <span className="models-env-label">{label}</span>
    <span className="models-env-value" title={title}>
      {children}
    </span>
  </div>
);

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  } catch {
    toast.error('Could not copy');
  }
}

export const EnvironmentCard: React.FC = () => {
  const [env, actions] = useEnvStore();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { status, paths, settingUp, progress, setupLines } = env;

  const uvMissing = status ? !status.uvAvailable : false;
  /** The venv is there but the import probe failed: a repair, not a first install. */
  const needsRepair = Boolean(status?.envExists && !status.ready);
  const isPascal = Boolean(status?.gpuName && PASCAL.test(status.gpuName));
  // A setup started before this window mounted (or in another window) shows up
  // as a running phase on the status, with settingUp still false here.
  const inSetup = settingUp || Boolean(status && SETUP_PHASES.includes(status.phase));
  const phase = progress?.phase ?? status?.phase ?? 'checking';
  // uv reports "0.12.13 (hash date target)" — only the number belongs in the grid.
  const uvVersion = status?.uvVersion?.split(' ')[0] ?? '?';

  const readyBadge = !status ? (
    <Badge variant="neutral">Checking…</Badge>
  ) : inSetup ? (
    <Badge variant="accent" icon={<LoaderIcon size={12} className="models-spin" />}>
      Setting up
    </Badge>
  ) : status.ready ? (
    <Badge variant="success">Ready</Badge>
  ) : status.envExists ? (
    <Badge variant="warning">Incomplete</Badge>
  ) : (
    <Badge variant="neutral">Not set up</Badge>
  );

  return (
    <Card
      title="Python environment"
      subtitle={`uv venv · torch · worker scripts v${status?.scriptsVersion ?? '?'} bundled`}
      icon={<WrenchIcon size={20} />}
      action={readyBadge}
    >
      <div className="models-env-grid">
        <Field label="uv" title={status?.uvVersion ?? undefined}>
          {status?.uvAvailable ? `v${uvVersion}` : <span className="models-danger">not found</span>}
        </Field>
        <Field label="env" title={paths?.env}>
          {status?.envExists ? (paths?.env ?? '~/.local-mesh/env') : <span className="models-muted">missing</span>}
        </Field>
        <Field label="python">{status?.pythonVersion ?? <span className="models-muted">unknown</span>}</Field>
        <Field label="torch">{status?.torchVersion ?? <span className="models-muted">unknown</span>}</Field>
        <Field label="gpu" wide>
          {status?.cudaAvailable ? (
            <>
              {status.gpuName ?? 'GPU'}
              <span className="models-muted"> · {formatGb(status.vramTotalBytes)} VRAM</span>
            </>
          ) : (
            <span className="models-warning">no CUDA device</span>
          )}
        </Field>
      </div>

      {uvMissing && (
        <div className="models-hint">
          <span>Install uv, then reopen this view:</span>
          <div className="models-code-row">
            <code className="models-code">{UV_INSTALL}</code>
            <Button size="sm" variant="subtle" icon={<CopyIcon size={14} />} onClick={() => copy(UV_INSTALL)}>
              Copy
            </Button>
          </div>
        </div>
      )}

      {isPascal && (
        <p className="models-env-note" title={`${status?.gpuName} has no bf16 and slow fp16 kernels for some ops, so precision defaults to fp32 compute.`}>
          <InfoIcon size={13} />
          Pascal card: setup installs the cu126 torch build and precision defaults to fp32.
        </p>
      )}

      {inSetup && (
        <div className="models-setup">
          <div className="models-setup-head">
            <span className="models-setup-phase">{PHASE_LABEL[phase] ?? phase}</span>
            <ProgressBar pct={progress?.pct ?? 0} indeterminate={!progress} />
            <span className="models-setup-pct">{Math.round(progress?.pct ?? 0)}%</span>
          </div>
          {progress?.message && <p className="models-setup-message">{progress.message}</p>}
          <SetupLog lines={setupLines} />
        </div>
      )}

      {status?.lastError && !inSetup && (
        <p className="models-env-error">
          <AlertTriangleIcon size={13} />
          {status.lastError}
        </p>
      )}

      <Card.Footer>
        {paths && (
          <Button size="sm" variant="subtle" icon={<FolderOpenIcon size={14} />} onClick={() => window.electronAPI?.openPath(paths.root)}>
            Open folder
          </Button>
        )}
        {status?.envExists && !inSetup && (
          <Button size="sm" variant="danger" icon={<TrashIcon size={14} />} onClick={() => setConfirmRemove(true)}>
            Remove
          </Button>
        )}
        {inSetup ? (
          <Button size="sm" variant="secondary" icon={<CancelIcon size={14} />} onClick={() => actions.cancelSetup()}>
            Cancel
          </Button>
        ) : (
          // Once the probe passes there is nothing left to do here: only Remove.
          !status?.ready && (
            <Button
              size="sm"
              variant="primary"
              icon={<WrenchIcon size={14} />}
              disabled={!status || uvMissing}
              title={uvMissing ? 'Install uv first' : undefined}
              onClick={() => actions.setup()}
            >
              {needsRepair ? 'Repair environment' : 'Set up environment'}
            </Button>
          )
        )}
      </Card.Footer>

      <Modal
        isOpen={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title="Remove the Python environment?"
        subtitle="Model weights are kept; only the virtualenv is deleted."
        icon={<AlertTriangleIcon size={20} />}
        size="sm"
      >
        <Modal.Body>
          <p>
            Setting it up again means downloading several GB of torch, and every model&apos;s Python dependencies have
            to be installed again.
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button size="sm" variant="subtle" onClick={() => setConfirmRemove(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={<TrashIcon size={14} />}
            onClick={async () => {
              setConfirmRemove(false);
              await actions.remove();
              toast.success('Environment removed');
            }}
          >
            Remove
          </Button>
        </Modal.Footer>
      </Modal>
    </Card>
  );
};
