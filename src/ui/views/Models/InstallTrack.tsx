import React from 'react';
import { CheckIcon, LoaderIcon, XCircleIcon } from '../../assets/icons';
import type { InstallStep } from './modelState';

function node(step: InstallStep, index: number): React.ReactNode {
  if (step.status === 'done') return <CheckIcon size={12} strokeWidth={3} />;
  if (step.status === 'running') return <LoaderIcon size={12} className="models-spin" />;
  if (step.status === 'failed') return <XCircleIcon size={12} />;
  return index + 1;
}

/** "Python engine: installed. Model files: 2.1 GB to download." */
export function trackSummary(steps: InstallStep[]): string {
  return steps.map((s) => `${s.label}: ${s.state.toLowerCase()}`).join('. ');
}

/**
 * The three things that have to be true before a model runs, drawn as the
 * sequence they actually are: a spine that fills as far as you have got. This
 * is the one place the view raises its voice, because "which of the three is
 * missing" is the question every new user is really asking.
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

/** The same information compressed to three marks, for a collapsed row. */
export const TrackMini: React.FC<{ steps: InstallStep[] }> = ({ steps }) => {
  const summary = trackSummary(steps);
  return (
    <span className="models-mini" role="img" aria-label={summary} title={summary}>
      {steps.map((step) => (
        <span key={step.key} className={`models-mini-seg is-${step.status}`} />
      ))}
    </span>
  );
};
