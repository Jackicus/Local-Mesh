import React, { useEffect, useMemo, useState } from 'react';
import type { LogChannel, LogEntry } from '../../../core/types';
import { Button, Form, Modal, Tooltip, toast } from '../../components';
import { AlertTriangleIcon, ChevronDownIcon, EraserIcon } from '../../assets/icons';
import { useLogStore } from '../../stores/logStore';
import { LogList, MAX_RENDERED } from './LogList';
import { LogToolbar, type LevelFilter, type SourceFilter } from './LogToolbar';
import { formatEntryText } from './LogRow';

const LEVEL_RANK = { debug: 0, info: 1, warn: 2, error: 3 } as const;
const MIN_RANK: Record<LevelFilter, number> = { all: 0, info: 1, warn: 2, error: 3 };

export const CHANNEL_TITLE: Record<LogChannel, string> = {
  general: 'general.log',
  errors: 'errors.log',
  generation: 'generation.log',
};

interface LogsPanelProps {
  /** Rendered as a chevron at the end of the header row when provided. */
  onCollapse?: () => void;
}

/**
 * The log reader itself — channel switch, filters, list. Mounted by the shell's
 * bottom dock; it fills whatever height its container gives it.
 */
export const LogsPanel: React.FC<LogsPanelProps> = ({ onCollapse }) => {
  const [logs, logActions] = useLogStore();
  const [channel, setChannel] = useState<LogChannel>('general');
  const [level, setLevel] = useState<LevelFilter>('all');
  const [source, setSource] = useState<SourceFilter>('all');
  const [search, setSearch] = useState('');
  const [follow, setFollow] = useState(true);
  const [groupByJob, setGroupByJob] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  // Mounted only while the dock is expanded, so "visible" is simply "errors".
  useEffect(() => {
    if (channel === 'errors') logActions.markErrorsSeen();
  }, [channel, logs.entries.errors.length, logActions]);

  const all = logs.entries[channel];
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const minRank = MIN_RANK[level];
    return all.filter(
      (e: LogEntry) =>
        LEVEL_RANK[e.level] >= minRank &&
        (source === 'all' || e.source === source) &&
        (needle === '' || e.message.toLowerCase().includes(needle) || (e.jobId?.toLowerCase().includes(needle) ?? false))
    );
  }, [all, level, source, search]);

  const copyVisible = async () => {
    const tail = filtered.slice(-MAX_RENDERED);
    try {
      await navigator.clipboard.writeText(tail.map(formatEntryText).join('\n'));
      toast.success(`Copied ${tail.length} entries`);
    } catch {
      toast.error('Could not copy');
    }
  };

  const openFolder = async () => {
    const paths = await window.electronAPI?.getPaths();
    if (paths) void window.electronAPI?.openPath(paths.logs);
  };

  const errorsLabel = (
    <span className="logs-tab-label">
      Errors
      {logs.unseenErrors > 0 && <span className="logs-tab-count">{logs.unseenErrors}</span>}
    </span>
  );

  return (
    <div className="logs-panel-root">
      <div className="logs-header">
        <Form.Segmented<LogChannel>
          size="sm"
          className="logs-channels"
          value={channel}
          onChange={setChannel}
          options={[
            { value: 'general', label: 'General' },
            { value: 'errors', label: errorsLabel },
            { value: 'generation', label: 'Generation' },
          ]}
        />

        <LogToolbar
          level={level}
          onLevel={setLevel}
          search={search}
          onSearch={setSearch}
          source={source}
          onSource={setSource}
          follow={follow}
          onFollow={setFollow}
          showGroup={channel === 'generation'}
          groupByJob={groupByJob}
          onGroupByJob={setGroupByJob}
          visibleCount={filtered.length}
          onCopy={copyVisible}
          onClear={() => setConfirmClear(true)}
          onOpenFolder={openFolder}
        />

        {onCollapse && (
          <Tooltip content="Collapse the log dock" position="top" align="end">
            <button type="button" className="logs-collapse-btn" onClick={onCollapse} aria-label="Collapse logs">
              <ChevronDownIcon size={16} />
            </button>
          </Tooltip>
        )}
      </div>

      <LogList
        entries={filtered}
        channelTotal={all.length}
        showJob={channel === 'generation'}
        groupByJob={channel === 'generation' && groupByJob}
        follow={follow}
        onUserScrolledUp={() => setFollow(false)}
      />

      <Modal
        isOpen={confirmClear}
        onClose={() => setConfirmClear(false)}
        title={`Clear ${CHANNEL_TITLE[channel]}?`}
        subtitle="Empties the in-app buffer and the file on disk."
        icon={<AlertTriangleIcon size={20} />}
        size="sm"
      >
        <Modal.Body>
          <p>This cannot be undone. Copy the entries first if you might need them.</p>
        </Modal.Body>
        <Modal.Footer>
          <Button size="sm" variant="subtle" onClick={() => setConfirmClear(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={<EraserIcon size={14} />}
            onClick={async () => {
              setConfirmClear(false);
              await logActions.clear(channel);
              toast.success(`Cleared ${CHANNEL_TITLE[channel]}`);
            }}
          >
            Clear
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};
