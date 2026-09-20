import React from 'react';

export interface ProgressBarProps {
  /** 0-100; clamped. */
  pct: number;
  /** A soft sweep for work with no measurable total (model loads). */
  indeterminate?: boolean;
}

/** The thin bar the view uses wherever something is measurably underway. */
export const ProgressBar: React.FC<ProgressBarProps> = ({ pct, indeterminate = false }) => {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div
      className={`gen-bar ${indeterminate ? 'is-indeterminate' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(clamped)}
    >
      <div className="gen-bar-fill" style={{ width: indeterminate ? '35%' : `${clamped}%` }} />
    </div>
  );
};
