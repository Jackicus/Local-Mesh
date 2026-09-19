import React from 'react';
import { Button } from '../../components';
import { DownloadIcon, CancelIcon, RefreshIcon, SparklesIcon, WrenchIcon } from '../../assets/icons';
import { dockStore } from '../../stores/dockStore';
import { modelStore } from '../../stores/modelStore';
import { blurb } from '../Models/copy';
import { TransferLine } from '../Models/TransferLine';
import { useInstallState } from '../Models/useInstallState';
import { getModel } from '../../../core/models';
import { useRunTarget } from './runTarget';

const ACTION_ICON = {
  install: <DownloadIcon size={15} />,
  retry: <RefreshIcon size={15} />,
  cancel: <CancelIcon size={15} />,
};

/**
 * First run, in the place a first run actually happens.
 *
 * Setup used to live only on the Models page, which meant the app opened on an
 * empty viewport with a greyed-out Generate button and a truncated line of
 * explanation — the one link out of it clipped off the end of the composer.
 * Nothing on screen said what to press.
 *
 * So the empty viewport asks for the one thing it needs and installs it in
 * place: same chained action as the Models view, same live line, no detour.
 * It replaces the "nothing loaded" state and disappears the moment the
 * selected pipeline can actually run.
 */
export const SetupCard: React.FC = () => {
  const target = useRunTarget();
  const state = useInstallState(target.modelId);
  const model = target.modelId ? getModel(target.modelId) : null;

  if (!model || !state || state.ready) return null;

  const { action, live, blocked } = state;
  const download = model.diskGb > 0 ? `${model.diskGb} GB` : null;

  return (
    <div className="gen-setup">
      <div className="gen-setup-card">
        <span className="gen-setup-glyph" aria-hidden="true">
          <SparklesIcon size={22} />
        </span>

        <h2 className="gen-setup-title">{state.running ? 'Setting things up' : 'One-time setup'}</h2>

        {!state.running && (
          <>
            <p className="gen-setup-lede">
              Local Mesh needs to fetch <strong>{model.name}</strong> before it can turn a picture into a shape
              {download ? <> — about {download}, and a few minutes</> : ''}. This happens once.
            </p>
            <p className="gen-setup-blurb">{blurb(model)}</p>
          </>
        )}

        {live && (
          <div className="gen-setup-progress">
            <TransferLine live={live} />
          </div>
        )}

        {blocked && (
          <p className="gen-setup-blocked">
            <WrenchIcon size={14} />
            <span>{blocked}</span>
          </p>
        )}

        <div className="gen-setup-actions">
          {action && (
            <Button
              variant={action.kind === 'cancel' ? 'secondary' : 'primary'}
              icon={ACTION_ICON[action.kind]}
              onClick={() =>
                action.kind === 'cancel'
                  ? void modelStore.cancelInstall(model.id)
                  : void modelStore.install(model.id)
              }
            >
              {action.label}
            </Button>
          )}
          <button type="button" className="gen-link" onClick={() => dockStore.setActiveItem('models')}>
            {blocked ? 'Show me how' : 'Pick a different model'}
          </button>
        </div>

        {!state.running && (
          <p className="gen-setup-foot">Everything stays on this computer. Nothing is uploaded.</p>
        )}
      </div>
    </div>
  );
};
