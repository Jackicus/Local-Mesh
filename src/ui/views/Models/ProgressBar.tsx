import React from 'react';

interface ProgressBarProps {
  /** 0-100; anything outside is clamped. */
  pct: number;
  /** Renders a soft pulse instead of a fill while the total is unknown. */
  indeterminate?: boolean;
  tone?: 'accent' | 'danger';
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ pct, indeterminate = false, tone = 'accent' }) => {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div
      className={`models-progress models-progress-${tone} ${indeterminate ? 'indeterminate' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(clamped)}
    >
      <div className="models-progress-fill" style={{ width: indeterminate ? '40%' : `${clamped}%` }} />
    </div>
  );
};
