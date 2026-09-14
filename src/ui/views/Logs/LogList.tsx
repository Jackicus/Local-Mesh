import React, { useLayoutEffect, useRef } from 'react';
import type { LogEntry } from '../../../core/types';
import { LogDivider, LogRow } from './LogRow';

export const MAX_RENDERED = 1000;

interface LogListProps {
  entries: LogEntry[];
  /** Entries in the channel before filtering (for the empty state copy). */
  channelTotal: number;
  showJob: boolean;
  groupByJob: boolean;
  follow: boolean;
  onUserScrolledUp: () => void;
}

export const LogList: React.FC<LogListProps> = ({
  entries,
  channelTotal,
  showJob,
  groupByJob,
  follow,
  onUserScrolledUp,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const truncated = entries.length > MAX_RENDERED;
  const visible = truncated ? entries.slice(entries.length - MAX_RENDERED) : entries;
  const lastId = visible.length ? visible[visible.length - 1]!.id : -1;

  // Pin to the tail before paint whenever new entries land and follow is on.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (follow && el) el.scrollTop = el.scrollHeight;
  }, [follow, lastId, visible.length, groupByJob]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el || !follow) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (fromBottom > 24) onUserScrolledUp();
  };

  if (visible.length === 0) {
    return (
      <div className="logs-panel logs-empty">
        <span className="logs-empty-title">{channelTotal === 0 ? 'No entries yet' : 'Nothing matches'}</span>
        <span className="logs-empty-hint">
          {channelTotal === 0
            ? 'Entries appear here as the app, the environment setup and the python worker write them.'
            : 'Loosen the level, source or search filter to see more.'}
        </span>
      </div>
    );
  }

  const rows: React.ReactNode[] = [];
  let lastJob: string | undefined | null = null;
  for (const entry of visible) {
    if (groupByJob && entry.jobId !== lastJob) {
      rows.push(<LogDivider key={`div-${entry.id}`} jobId={entry.jobId} />);
      lastJob = entry.jobId;
    }
    rows.push(<LogRow key={entry.id} entry={entry} showJob={showJob} />);
  }

  return (
    <div ref={scrollRef} className="logs-panel" onScroll={handleScroll}>
      {truncated && (
        <div className="logs-truncated">
          Showing the last {MAX_RENDERED} of {entries.length} matching entries — use the files in the logs folder for the full history.
        </div>
      )}
      {rows}
    </div>
  );
};
