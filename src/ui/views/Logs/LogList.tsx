import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { LogEntry } from '../../../core/types';
import { JumpToBottomIcon } from '../../assets/icons';
import { LogRow } from './LogRow';

export const MAX_RENDERED = 1000;

/** How close to the bottom still counts as "watching the tail". */
const STICK_THRESHOLD = 32;

interface LogListProps {
  entries: LogEntry[];
  showJob: boolean;
  /** Copy for the empty state, worded per channel. */
  emptyTitle: string;
  emptyHint: string;
}

/**
 * The scroller. It follows the newest entry while the reader is already at the
 * bottom and stops the moment they scroll up, so nothing is yanked out from
 * under them; scrolling back down re-attaches. Only the last MAX_RENDERED
 * entries are in the DOM — the files hold the rest.
 */
export const LogList: React.FC<LogListProps> = ({ entries, showJob, emptyTitle, emptyHint }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [detached, setDetached] = useState(false);

  const truncated = entries.length > MAX_RENDERED;
  const visible = truncated ? entries.slice(entries.length - MAX_RENDERED) : entries;
  const lastId = visible.length ? visible[visible.length - 1]!.id : -1;

  // Pin to the tail before paint whenever new entries land and we are attached.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [lastId, visible.length]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const stick = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_THRESHOLD;
    if (stick === stickRef.current) return;
    stickRef.current = stick;
    setDetached(!stick);
  }, []);

  const jumpToNewest = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = true;
    setDetached(false);
    el.scrollTop = el.scrollHeight;
  };

  if (visible.length === 0) {
    return (
      <div className="logs-list">
        <div className="logs-empty">
          <span className="logs-empty-title">{emptyTitle}</span>
          <span className="logs-empty-hint">{emptyHint}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="logs-list">
      <div ref={scrollRef} className="logs-scroll" onScroll={handleScroll}>
        {truncated && (
          <div className="logs-truncated">
            Showing the last {MAX_RENDERED.toLocaleString()} of {entries.length.toLocaleString()} entries. Open the
            logs folder for the full history.
          </div>
        )}
        {visible.map((entry) => (
          <LogRow key={entry.id} entry={entry} showJob={showJob} />
        ))}
      </div>

      {detached && (
        <button type="button" className="logs-jump" onClick={jumpToNewest}>
          <JumpToBottomIcon size={13} />
          Newest
        </button>
      )}
    </div>
  );
};
