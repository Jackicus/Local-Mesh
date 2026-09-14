import React from 'react';

export interface ProgressBarProps {
  /** 0-100; clamped. */
  pct: number;
  tone?: 'accent' | 'success' | 'warning' | 'danger';
  /** A soft sweep for work with no measurable total (model loads). */
  indeterminate?: boolean;
}

/** The one bar shape the view uses: queue rows, VRAM, downloads-in-progress. */
export const ProgressBar: React.FC<ProgressBarProps> = ({ pct, tone = 'accent', indeterminate = false }) => {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div
      className={`gen-bar gen-bar-${tone} ${indeterminate ? 'is-indeterminate' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(clamped)}
    >
      <div className="gen-bar-fill" style={{ width: indeterminate ? '35%' : `${clamped}%` }} />
    </div>
  );
};
