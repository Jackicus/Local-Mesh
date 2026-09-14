import React from 'react';
import { useNow } from '../../hooks';
import { formatElapsed } from './format';

interface ElapsedTimeProps {
  /** ms since epoch the clock started from. */
  since: number;
  className?: string;
  title?: string;
}

/**
 * A live stopwatch. Kept as its own component so the shared ticker only runs
 * while something is actually counting — render it only for active work.
 */
export const ElapsedTime: React.FC<ElapsedTimeProps> = ({ since, className = '', title }) => {
  const now = useNow(500);
  return (
    <span className={`gen-elapsed ${className}`} title={title}>
      {formatElapsed(Math.max(0, now - since))}
    </span>
  );
};
