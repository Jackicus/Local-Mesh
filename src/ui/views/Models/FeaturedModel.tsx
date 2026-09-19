import React from 'react';
import type { ModelDefinition, ModelInstallState } from '../../../core/types';
import { Badge, Card } from '../../components';
import { SparklesIcon } from '../../assets/icons';
import { blurb } from './copy';
import { InstallTrack } from './InstallTrack';
import { BlockedNote, ModelUtilities, PrimaryAction, type ModelHandlers } from './ModelActions';
import type { ModelState } from './modelState';
import { TransferLine } from './TransferLine';

interface FeaturedModelProps {
  model: ModelDefinition;
  install?: ModelInstallState;
  state: ModelState;
  loaded: boolean;
  busy: boolean;
  handlers: ModelHandlers;
}

const Fact: React.FC<{ label: string; value: string; hint?: string; tone?: string }> = ({
  label,
  value,
  hint,
  tone,
}) => (
  <div className="models-fact" title={hint}>
    <span className="models-fact-label">{label}</span>
    <span className={`models-fact-value ${tone ?? ''}`}>{value}</span>
  </div>
);

/**
 * The answer to "which one do I pick?" — one model, promoted to a card, chosen
 * for the card this machine actually has. It only exists while nothing is
 * installed; once something works, this model rejoins the list like any other.
 */
export const FeaturedModel: React.FC<FeaturedModelProps> = ({
  model,
  install,
  state,
  loaded,
  busy,
  handlers,
}) => (
  <Card className="models-featured">
    <Card.Header>
      <div className="ui-card-title-group">
        <span className="ui-card-icon">
          <SparklesIcon size={20} />
        </span>
        <div>
          <p className="models-eyebrow">Start here</p>
          <h3 className="ui-card-title">{model.name}</h3>
        </div>
      </div>
      <div className="ui-card-action">
        <Badge variant={state.status.variant}>{state.status.label}</Badge>
      </div>
    </Card.Header>

    <Card.Body>
      <p className="models-featured-blurb">{blurb(model)}</p>

      <div className="models-facts">
        <Fact
          label="Download"
          value={model.diskGb > 0 ? `${model.diskGb} GB` : 'None'}
          hint="Model files, fetched straight from Hugging Face."
        />
        <Fact
          label="Graphics memory"
          value={model.vramGb > 0 ? `~${model.vramGb} GB` : 'None'}
          hint="Roughly what it needs on the graphics card while it runs."
        />
        {state.fit && (
          <Fact label="Your card" value={state.fit.label} hint={state.fit.detail} tone={`is-${state.fit.verdict}`} />
        )}
      </div>

      <InstallTrack steps={state.steps} />

      {state.progress && <TransferLine progress={state.progress} />}
      {state.blocked && !state.running && <BlockedNote reason={state.blocked} onFix={handlers.onFixEngine} />}
    </Card.Body>

    <Card.Footer>
      <ModelUtilities model={model} install={install} state={state} loaded={loaded} busy={busy} handlers={handlers} />
      <PrimaryAction state={state} handlers={handlers} size="md" />
    </Card.Footer>
  </Card>
);
