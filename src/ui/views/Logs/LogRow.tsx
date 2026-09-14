import React from 'react';
import type { LogEntry } from '../../../core/types';

export function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function shortJobId(jobId: string): string {
  return jobId.length > 6 ? jobId.slice(-6) : jobId;
}

/** One entry as plain text, the shape "Copy" produces. */
export function formatEntryText(entry: LogEntry): string {
  const job = entry.jobId ? ` [${shortJobId(entry.jobId)}]` : '';
  return `${formatTime(entry.ts)} ${entry.level.toUpperCase().padEnd(5)} ${entry.source.padEnd(8)}${job} ${entry.message}`;
}

interface LogRowProps {
  entry: LogEntry;
  showJob: boolean;
}

export const LogRow = React.memo<LogRowProps>(({ entry, showJob }) => (
  <div className={`logs-row logs-row-${entry.level}`}>
    <span className="logs-time">{formatTime(entry.ts)}</span>
    <span className={`logs-level logs-level-${entry.level}`}>{entry.level.slice(0, 4)}</span>
    <span className="logs-source">{entry.source}</span>
    {showJob && (
      <span className="logs-job" title={entry.jobId}>
        {entry.jobId ? shortJobId(entry.jobId) : ''}
      </span>
    )}
    <span className="logs-message">{entry.message}</span>
  </div>
));

LogRow.displayName = 'LogRow';

export const LogDivider: React.FC<{ jobId: string | undefined }> = ({ jobId }) => (
  <div className="logs-divider">
    <span>{jobId ? `job ${shortJobId(jobId)}` : 'no job'}</span>
  </div>
);
