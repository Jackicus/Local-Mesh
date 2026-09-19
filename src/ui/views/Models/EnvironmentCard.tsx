import React, { useState } from 'react';
import type { EnvPhase } from '../../../core/types';
import { Badge, Button, Card, Modal, toast } from '../../components';
import {
  AlertTriangleIcon,
  CancelIcon,
  CheckCircleIcon,
  CopyIcon,
  CpuIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  LoaderIcon,
  RefreshIcon,
  TrashIcon,
  WrenchIcon,
} from '../../assets/icons';
import { useEnvStore } from '../../stores/envStore';
import { Disclosure } from './Disclosure';
import { ProgressBar } from './ProgressBar';
import { SetupLog } from './SetupLog';
import { formatGb } from './formatBytes';
import { PHASE_LABEL, UV_HOME, UV_INSTALL } from './copy';

/** Phases main only reports while a setup is actually running (never on a status poll). */
const SETUP_PHASES: EnvPhase[] = ['creating-venv', 'installing-torch', 'installing-base', 'verifying'];

const PASCAL = /GTX 10|Pascal|P100|Titan X/i;

const Detail: React.FC<{ label: string; title?: string; children: React.ReactNode }> = ({
  label,
  title,
  children,
}) => (
  <div className="models-detail">
    <span className="models-detail-label">{label}</span>
    <span className="models-detail-value" title={title}>
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

/**
 * Step one, and the only step that is shared: a private Python with PyTorch in
 * it. The card leads with a sentence about where you are and one button; every
 * version string it used to put on the front page now lives behind "Technical
 * details".
 */
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

  const badge = !status ? (
    <Badge variant="neutral">Checking</Badge>
  ) : inSetup ? (
    <Badge variant="accent" icon={<LoaderIcon size={12} className="models-spin" />}>
      Installing
    </Badge>
  ) : status.ready ? (
    <Badge variant="success" icon={<CheckCircleIcon size={12} />}>
      Ready
    </Badge>
  ) : status.envExists ? (
    <Badge variant="warning">Needs repair</Badge>
  ) : (
    <Badge variant="neutral">Not installed</Badge>
  );

  const gpuLine = () => {
    if (status?.cudaAvailable === true) {
      return (
        <>
          Running on <strong>{status.gpuName ?? 'your graphics card'}</strong>
          {status.vramTotalBytes ? ` with ${formatGb(status.vramTotalBytes)} of graphics memory` : ''}.
        </>
      );
    }
    if (status?.cudaAvailable === false) {
      return 'No NVIDIA graphics card was found, so models will run on the processor instead. That works, but expect many minutes per mesh.';
    }
    return 'Your graphics card is checked while the engine installs.';
  };

  return (
    <Card className="models-engine">
      <Card.Header>
        <div className="ui-card-title-group">
          <span className="ui-card-icon">
            <CpuIcon size={20} />
          </span>
          <div>
            <h3 className="ui-card-title">Shared setup</h3>
            <p className="ui-card-subtitle">Installed once, used by every model</p>
          </div>
        </div>
        <div className="ui-card-action">{badge}</div>
      </Card.Header>

      <Card.Body>
        {uvMissing ? (
          <div className="models-blocker">
            <p className="models-blocker-title">
              <AlertTriangleIcon size={15} />
              One small helper is missing
            </p>
            <p className="models-blocker-text">
              This is the only part Local Mesh cannot install for you. Copy the line below, paste it into a terminal
              and press Enter, then come back and press Check again.
            </p>
            <div className="models-code-row">
              <code className="models-code">{UV_INSTALL}</code>
              <Button size="sm" variant="subtle" icon={<CopyIcon size={14} />} onClick={() => void copy(UV_INSTALL)}>
                Copy
              </Button>
            </div>
            <div className="models-blocker-actions">
              <Button size="sm" variant="primary" icon={<RefreshIcon size={14} />} onClick={() => void actions.refresh()}>
                Check again
              </Button>
              <Button
                size="sm"
                variant="subtle"
                icon={<ExternalLinkIcon size={14} />}
                onClick={() => window.electronAPI?.openExternal(UV_HOME)}
              >
                Other ways to install uv
              </Button>
            </div>
          </div>
        ) : inSetup ? (
          <div className="models-setup">
            <p className="models-setup-phase">{PHASE_LABEL[phase] ?? phase}</p>
            <div className="models-transfer-bar">
              <ProgressBar pct={progress?.pct ?? 0} indeterminate={!progress} />
              <span className="models-transfer-pct">{Math.round(progress?.pct ?? 0)}%</span>
            </div>
            {progress?.message && (
              <p className="models-transfer-detail" title={progress.message}>
                {progress.message}
              </p>
            )}
            <p className="models-note">This runs unattended. You can leave the page, or start a model download while it works.</p>
            <SetupLog lines={setupLines} />
          </div>
        ) : !status ? (
          <p className="models-lede">Checking what is already installed…</p>
        ) : status.ready ? (
          <p className="models-lede">{gpuLine()}</p>
        ) : needsRepair ? (
          <p className="models-lede">
            The engine is here but something in it is broken, so no model can run yet. Repairing reinstalls the parts
            that failed and keeps every model file you have already downloaded.
          </p>
        ) : (
          <>
            <p className="models-lede">
              Nothing is installed yet. This one step puts a private copy of Python and PyTorch inside Local Mesh — the
              program that actually runs the models. Every model shares it, and nothing is added to the rest of your
              computer.
            </p>
            <p className="models-cost">
              Several gigabytes to download · a few minutes · kept in{' '}
              <code className="models-inline-code">{paths?.root ?? '~/.local-mesh'}</code>
            </p>
          </>
        )}

        {status?.lastError && !inSetup && !uvMissing && (
          <p className="models-error">
            <AlertTriangleIcon size={14} />
            {status.lastError}
          </p>
        )}

        {status && (
          <Disclosure summary="Technical details">
            <div className="models-detail-grid">
              <Detail label="uv" title={status.uvVersion ?? undefined}>
                {status.uvAvailable ? (status.uvVersion?.split(' ')[0] ?? 'installed') : 'not found'}
              </Detail>
              <Detail label="Python">{status.pythonVersion ?? 'not probed yet'}</Detail>
              <Detail label="PyTorch">{status.torchVersion ?? 'not probed yet'}</Detail>
              <Detail label="Worker scripts">v{status.scriptsVersion}</Detail>
              <Detail label="Graphics">
                {status.cudaAvailable
                  ? `${status.gpuName ?? 'GPU'} · ${formatGb(status.vramTotalBytes)}`
                  : status.cudaAvailable === false
                    ? 'CPU only'
                    : 'not probed yet'}
              </Detail>
              <Detail label="Folder" title={paths?.env}>
                {status.envExists ? (paths?.env ?? '~/.local-mesh/env') : 'not created'}
              </Detail>
            </div>
            {isPascal && (
              <p className="models-note">
                {status.gpuName} is a Pascal-generation card: it has no bf16 and its fp16 kernels are slow for some
                operations, so Local Mesh installs the CUDA 12.6 build of PyTorch and computes in 32-bit by default.
                Slower, but correct.
              </p>
            )}
          </Disclosure>
        )}
      </Card.Body>

      <Card.Footer>
        {paths && (
          <Button
            size="sm"
            variant="subtle"
            className="models-footer-spacer"
            icon={<FolderOpenIcon size={14} />}
            onClick={() => window.electronAPI?.openPath(paths.root)}
          >
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
            Stop
          </Button>
        ) : (
          !status?.ready &&
          !uvMissing && (
            <Button
              size="sm"
              variant="primary"
              icon={<WrenchIcon size={14} />}
              disabled={!status}
              onClick={() => void actions.setup()}
            >
              {needsRepair ? 'Repair it' : 'Install it'}
            </Button>
          )
        )}
      </Card.Footer>

      <Modal
        isOpen={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title="Remove the shared setup?"
        subtitle="Your downloaded model files are kept."
        icon={<AlertTriangleIcon size={20} />}
        size="sm"
      >
        <Modal.Body>
          <p>
            Putting it back means downloading several gigabytes of PyTorch again, and every model&apos;s extra packages
            have to be installed a second time.
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button size="sm" variant="subtle" onClick={() => setConfirmRemove(false)}>
            Keep it
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={<TrashIcon size={14} />}
            onClick={() => {
              setConfirmRemove(false);
              // envStore.remove does not swallow a rejection, and the modal is
              // already gone by then: without this the failure is invisible.
              void actions
                .remove()
                .then(() => toast.success('Shared setup removed'))
                .catch((err: unknown) =>
                  toast.error(err instanceof Error ? err.message : String(err), { title: 'Could not remove the engine' })
                );
            }}
          >
            Remove
          </Button>
        </Modal.Footer>
      </Modal>
    </Card>
  );
};
