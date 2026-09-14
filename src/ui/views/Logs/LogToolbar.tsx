import React from 'react';
import type { LogSource } from '../../../core/types';
import { Button, Form, Tooltip } from '../../components';
import {
  ClipboardCopyIcon,
  EraserIcon,
  FolderOpenIcon,
  FollowIcon,
  GroupRowsIcon,
  SearchIcon,
} from '../../assets/icons';

export type LevelFilter = 'all' | 'info' | 'warn' | 'error';
export type SourceFilter = 'all' | LogSource;

const SOURCE_OPTIONS: Array<{ value: SourceFilter; label: string }> = [
  { value: 'all', label: 'All sources' },
  { value: 'main', label: 'main' },
  { value: 'renderer', label: 'renderer' },
  { value: 'worker', label: 'worker' },
  { value: 'env', label: 'env' },
  { value: 'download', label: 'download' },
];

interface LogToolbarProps {
  level: LevelFilter;
  onLevel: (v: LevelFilter) => void;
  search: string;
  onSearch: (v: string) => void;
  source: SourceFilter;
  onSource: (v: SourceFilter) => void;
  follow: boolean;
  onFollow: (v: boolean) => void;
  showGroup: boolean;
  groupByJob: boolean;
  onGroupByJob: (v: boolean) => void;
  visibleCount: number;
  onCopy: () => void;
  onClear: () => void;
  onOpenFolder: () => void;
}

export const LogToolbar: React.FC<LogToolbarProps> = ({
  level,
  onLevel,
  search,
  onSearch,
  source,
  onSource,
  follow,
  onFollow,
  showGroup,
  groupByJob,
  onGroupByJob,
  visibleCount,
  onCopy,
  onClear,
  onOpenFolder,
}) => (
  <div className="logs-toolbar">
    <div className="logs-toolbar-filters">
      <Form.Segmented<LevelFilter>
        size="sm"
        value={level}
        onChange={onLevel}
        options={[
          { value: 'all', label: 'All' },
          { value: 'info', label: 'Info+' },
          { value: 'warn', label: 'Warn+' },
          { value: 'error', label: 'Error' },
        ]}
      />
      <Form.Select
        size="sm"
        className="logs-source-select"
        value={source}
        onChange={(e) => onSource(e.target.value as SourceFilter)}
        options={SOURCE_OPTIONS}
        aria-label="Source"
      />
      <Form.Input
        size="sm"
        className="logs-search"
        icon={<SearchIcon size={14} />}
        placeholder="Search messages"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        aria-label="Search"
      />
    </div>

    <div className="logs-toolbar-actions">
      <span className="logs-count">{visibleCount} shown</span>
      {showGroup && (
        <Tooltip content="Insert a divider whenever the job changes">
          <Button
            size="sm"
            variant={groupByJob ? 'primary' : 'subtle'}
            icon={<GroupRowsIcon size={14} />}
            onClick={() => onGroupByJob(!groupByJob)}
            aria-pressed={groupByJob}
          >
            Group by job
          </Button>
        </Tooltip>
      )}
      <Tooltip content="Keep scrolled to the newest entry">
        <Button
          size="sm"
          variant={follow ? 'primary' : 'subtle'}
          icon={<FollowIcon size={14} />}
          onClick={() => onFollow(!follow)}
          aria-pressed={follow}
        >
          Follow
        </Button>
      </Tooltip>
      <Button size="sm" variant="subtle" icon={<ClipboardCopyIcon size={14} />} onClick={onCopy} disabled={visibleCount === 0}>
        Copy
      </Button>
      <Button size="sm" variant="subtle" icon={<FolderOpenIcon size={14} />} onClick={onOpenFolder}>
        Open folder
      </Button>
      <Button size="sm" variant="danger" icon={<EraserIcon size={14} />} onClick={onClear}>
        Clear
      </Button>
    </div>
  </div>
);
