import React from 'react';
import { CheckIcon, LoaderIcon, XCircleIcon } from '../../assets/icons';
import type { InstallStep } from './modelState';

function node(step: InstallStep, index: number): React.ReactNode {
  if (step.status === 'done') return <CheckIcon size={12} strokeWidth={3} />;
  if (step.status === 'running') return <LoaderIcon size={12} className="models-spin" />;
  if (step.status === 'failed') return <XCircleIcon size={12} />;
  return index + 1;
}

/**
 * The three things that have to be true before a model runs, drawn as the
 * sequence they actually are. Install does all three on its own, so this is no
 * longer anybody's next step — it lives behind a disclosure, for the one user
 * in fifty who wants to know what the button is actually doing.
 */
export const InstallTrack: React.FC<{ steps: InstallStep[] }> = ({ steps }) => (
  <ol className="models-track">
    {steps.map((step, i) => (
      <li key={step.key} className={`models-track-step is-${step.status}`}>
        <span className="models-track-node" aria-hidden="true">
          {node(step, i)}
        </span>
        <span className="models-track-label">{step.label}</span>
        <span className="models-track-state">{step.state}</span>
        <span className="models-track-help">{step.help}</span>
      </li>
    ))}
  </ol>
);
