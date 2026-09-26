import React, { useState } from 'react';
import type { ModelDefinition, ModelInstallState } from '../../../core/types';
import { Badge } from '../../components';
import { ChevronRightIcon, MemoryIcon } from '../../assets/icons';
import { blurb, tagLabels } from './copy';
import { Disclosure } from './Disclosure';
import { formatBytes } from './formatBytes';
import { InstallTrack } from './InstallTrack';
import { BlockedNote, InstallActions, ModelUtilities, type ModelHandlers } from './ModelActions';
import type { ModelState } from './modelState';
import { TransferLine } from './TransferLine';

interface ModelRowProps {
  model: ModelDefinition;
  install?: ModelInstallState;
  state: ModelState;
  loaded: boolean;
  busy: boolean;
  handlers: ModelHandlers;
}

/**
 * One model as a line in a list, not a card in a grid: eight tall cards all
 * shouting at the same volume is what made this screen hard to read. The line
 * carries the name, what it is for, what it costs and whatever is still
 * outstanding — the files, the setup, or both; everything else is one click
 * down.
 */
export const ModelRow: React.FC<ModelRowProps> = ({ model, install, state, loaded, busy, handlers }) => {
  const [open, setOpen] = useState(false);
  const tags = tagLabels(model);
  const sizeOnDisk = install && install.sizeBytes > 0 ? formatBytes(install.sizeBytes) : null;

  // One cost, not three. Whether it runs on this card is the only other thing
  // worth saying before you have decided to install it; the graphics-memory
  // figure behind that verdict lives in the details panel. Files that are
  // already here are "on disk" even while the setup half is still outstanding:
  // quoting the download size for a model that has finished downloading reads
  // as a second bill.
  const facts = [
    install?.weights === 'complete' && sizeOnDisk
      ? `${sizeOnDisk} on disk`
      : model.diskGb > 0
        ? `${model.diskGb} GB download`
        : 'nothing to download',
  ];
  const verdict = state.fit && state.fit.verdict !== 'unknown' ? state.fit : null;

  return (
    <li className={`models-row ${open ? 'is-open' : ''}`}>
      <div className="models-row-head">
        <button
          type="button"
          className="models-row-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronRightIcon size={14} className="models-row-chevron" />
          <span className="models-row-title">
            <span className="models-row-name">{model.name}</span>
            {tags.map((tag) => (
              <Badge key={tag.label} variant={tag.variant} className="models-pill">
                {tag.label}
              </Badge>
            ))}
            {loaded && (
              <Badge variant="success" className="models-pill" icon={<MemoryIcon size={11} />}>
                In memory
              </Badge>
            )}
          </span>
          <span className="models-row-blurb">{blurb(model)}</span>
          <span className="models-row-facts">
            {facts.join(' · ')}
            {verdict && (
              <>
                {' · '}
                <span className={`models-fit is-${verdict.verdict}`} title={verdict.detail}>
                  {verdict.label}
                </span>
              </>
            )}
          </span>
        </button>

        <div className="models-row-side">
          <span className="models-row-status">
            <Badge variant={state.status.variant} className="models-pill">
              {state.status.label}
            </Badge>
          </span>
          <InstallActions state={state} handlers={handlers} />
        </div>
      </div>

      {/* Two lines, because both halves can be moving at once and each one
          belongs under the button that started it. */}
      {state.filesLive && <TransferLine live={state.filesLive} />}
      {state.runtimeLive && <TransferLine live={state.runtimeLive} />}
      {state.blocked && !state.running && <BlockedNote reason={state.blocked} onFix={handlers.onFixEngine} />}

      {open && (
        <div className="models-row-detail">
          <p className="models-row-expert">{model.description}</p>
          <div className="models-detail-grid">
            <div className="models-detail">
              <span className="models-detail-label">Graphics memory</span>
              <span className="models-detail-value" title={state.fit?.detail}>
                {model.vramGb > 0 ? `about ${model.vramGb} GB` : 'none needed'}
              </span>
            </div>
            <div className="models-detail">
              <span className="models-detail-label">Made by</span>
              <span className="models-detail-value">{model.vendor}</span>
            </div>
            <div className="models-detail">
              <span className="models-detail-label">Size</span>
              <span className="models-detail-value">{model.params === '0' ? 'n/a' : `${model.params} parameters`}</span>
            </div>
            <div className="models-detail">
              <span className="models-detail-label">Licence</span>
              <span className="models-detail-value">{model.license}</span>
            </div>
            <div className="models-detail">
              <span className="models-detail-label">Released</span>
              <span className="models-detail-value">{model.releaseDate}</span>
            </div>
            {model.hfRepo && (
              <div className="models-detail">
                <span className="models-detail-label">Downloaded from</span>
                <span className="models-detail-value" title={model.hfRepo}>
                  {model.hfRepo}
                </span>
              </div>
            )}
            {install && sizeOnDisk && (
              <div className="models-detail">
                <span className="models-detail-label">Folder</span>
                <span className="models-detail-value" title={install.dir}>
                  {install.dir}
                </span>
              </div>
            )}
          </div>
          {!state.ready && (
            <Disclosure summary="What installing does" className="models-row-track">
              <InstallTrack steps={state.steps} />
            </Disclosure>
          )}
          <div className="models-row-tools">
            <ModelUtilities
              model={model}
              install={install}
              state={state}
              loaded={loaded}
              busy={busy}
              handlers={handlers}
            />
          </div>
        </div>
      )}
    </li>
  );
};
