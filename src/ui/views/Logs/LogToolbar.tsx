import React from 'react';
import { Button } from '../../components';
import { ClipboardCopyIcon, EraserIcon, FolderOpenIcon } from '../../assets/icons';

interface LogToolbarProps {
  /** The file the three actions act on, e.g. "general.log". */
  fileName: string;
  entryCount: number;
  onCopy: () => void;
  onOpenFolder: () => void;
  onClear: () => void;
}

/**
 * The only controls the reader has: what file you are looking at, and the
 * three things you can do with it. No filters, no search — scroll and read.
 */
export const LogToolbar: React.FC<LogToolbarProps> = ({
  fileName,
  entryCount,
  onCopy,
  onOpenFolder,
  onClear,
}) => (
  <div className="logs-toolbar">
    <span className="logs-file">
      {fileName}
      <span className="logs-file-count">
        {entryCount.toLocaleString()} {entryCount === 1 ? 'entry' : 'entries'}
      </span>
    </span>

    <div className="logs-toolbar-actions">
      <Button
        size="sm"
        variant="subtle"
        icon={<ClipboardCopyIcon size={14} />}
        onClick={onCopy}
        disabled={entryCount === 0}
      >
        Copy
      </Button>
      <Button size="sm" variant="subtle" icon={<FolderOpenIcon size={14} />} onClick={onOpenFolder}>
        Open folder
      </Button>
      <Button
        size="sm"
        variant="subtle"
        icon={<EraserIcon size={14} />}
        onClick={onClear}
        disabled={entryCount === 0}
      >
        Clear
      </Button>
    </div>
  </div>
);
