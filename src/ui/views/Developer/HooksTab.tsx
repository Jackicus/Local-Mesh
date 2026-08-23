import React from 'react';
import { Card, Badge, Button } from '../../components';
import {
  KeyboardIcon,
  AppWindowIcon,
  MinimizeIcon,
  MaximizeIcon,
  RestoreIcon,
} from '../../assets/icons';
import { APP_SHORTCUTS, useWindowControls } from '../../hooks';
import { ClaudeMdCard } from './ClaudeMdCard';
import { InventoryCard } from './InventoryCard';

export const HooksTab: React.FC = () => {
  const { isMaximized, minimize, maximize } = useWindowControls();

  const registeredShortcuts = APP_SHORTCUTS.filter((s) => s.type === 'registered');
  const defaultShortcuts = APP_SHORTCUTS.filter((s) => s.type === 'default');

  return (
    <div className="view-list">
      <InventoryCard
        path="src/ui/hooks"
        items={[
          { name: 'useWindowControls', note: 'window minimize / maximize / close over the IPC bridge; no-ops in a plain browser' },
          { name: 'useKeyboardShortcuts', note: <>binds every entry in <code>APP_SHORTCUTS</code> with one window listener; also feeds the Help screen</> },
        ]}
      />

      <Card
        title="useWindowControls"
        subtitle="Live window state, driven over IPC"
        icon={<AppWindowIcon size={20} />}
        action={
          <Badge variant={isMaximized ? 'accent' : 'neutral'}>
            {isMaximized ? 'Maximized' : 'Normal Window'}
          </Badge>
        }
      >
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button size="sm" variant="secondary" icon={<MinimizeIcon size={14} />} onClick={minimize}>
            Minimize
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={isMaximized ? <RestoreIcon size={14} /> : <MaximizeIcon size={14} />}
            onClick={maximize}
          >
            {isMaximized ? 'Restore' : 'Maximize'}
          </Button>
        </div>
      </Card>

      <Card
        title="useKeyboardShortcuts"
        subtitle="Everything registered in APP_SHORTCUTS"
        icon={<KeyboardIcon size={20} />}
        action={<Badge variant="neutral">{APP_SHORTCUTS.length} shortcuts</Badge>}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div className="shortcut-group-label">Application Handlers</div>
          {registeredShortcuts.map((shortcut) => (
            <div key={shortcut.id} className="shortcut-row">
              <span>{shortcut.description}</span>
              <kbd>{shortcut.keys}</kbd>
            </div>
          ))}

          <div className="shortcut-group-label" style={{ marginTop: '6px' }}>
            Desktop / Window Defaults
          </div>
          {defaultShortcuts.map((shortcut) => (
            <div key={shortcut.id} className="shortcut-row">
              <span>{shortcut.description}</span>
              <kbd>{shortcut.keys}</kbd>
            </div>
          ))}
        </div>
      </Card>

      <ClaudeMdCard dir="hooks" />
    </div>
  );
};
