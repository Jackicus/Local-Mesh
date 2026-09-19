import React, { useEffect, useState } from 'react';
import type { LogChannel } from '../../../core/types';
import { Button, Form, Modal, Tooltip, toast } from '../../components';
import { AlertTriangleIcon, ChevronDownIcon, EraserIcon } from '../../assets/icons';
import { useLogStore } from '../../stores/logStore';
import { LogList, MAX_RENDERED } from './LogList';
import { LogToolbar } from './LogToolbar';
import { formatEntryText } from './LogRow';

export const CHANNEL_TITLE: Record<LogChannel, string> = {
  general: 'general.log',
  errors: 'errors.log',
  generation: 'generation.log',
};

const EMPTY_COPY: Record<LogChannel, { title: string; hint: string }> = {
  general: {
    title: 'Nothing logged yet',
    hint: 'Entries land here as the app, the environment setup and the python worker write them.',
  },
  errors: {
    title: 'No errors',
    hint: 'Anything that fails in the app, the environment or the worker is copied here as it happens.',
  },
  generation: {
    title: 'No generation runs yet',
    hint: 'Start a job from the Generate view and its progress appears here line by line.',
  },
};

interface LogsPanelProps {
  /** Rendered as a chevron at the end of the header row when provided. */
  onCollapse?: () => void;
}

/**
 * The log reader itself — channel switch, three actions, list. Mounted by the
 * shell's bottom dock; it fills whatever height its container gives it.
 */
export const LogsPanel: React.FC<LogsPanelProps> = ({ onCollapse }) => {
  const [logs, logActions] = useLogStore();
  const [channel, setChannel] = useState<LogChannel>('general');
  const [confirmClear, setConfirmClear] = useState(false);

  // Mounted only while the dock is open, so "visible" is simply "errors".
  useEffect(() => {
    if (channel === 'errors') logActions.markErrorsSeen();
  }, [channel, logs.entries.errors.length, logActions]);

  const entries = logs.entries[channel];

  const copyVisible = async () => {
    const tail = entries.slice(-MAX_RENDERED);
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
          fileName={CHANNEL_TITLE[channel]}
          entryCount={entries.length}
          onCopy={copyVisible}
          onOpenFolder={openFolder}
          onClear={() => setConfirmClear(true)}
        />

        {onCollapse && (
          <Tooltip content="Collapse the log dock" position="top" align="end">
            <button type="button" className="logs-collapse-btn" onClick={onCollapse} aria-label="Collapse logs">
              <ChevronDownIcon size={16} />
            </button>
          </Tooltip>
        )}
      </div>

      {/* Keyed on the channel so switching starts at the newest entry again */}
      <LogList
        key={channel}
        entries={entries}
        showJob={channel === 'generation'}
        emptyTitle={EMPTY_COPY[channel].title}
        emptyHint={EMPTY_COPY[channel].hint}
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
