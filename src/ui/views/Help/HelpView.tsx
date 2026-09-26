import React from 'react';
import { Card, Badge, Button } from '../../components';
import {
  KeyboardIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  ExternalLinkIcon,
  HelpIcon,
  SparklesIcon,
} from '../../assets/icons';
import { APP_SHORTCUTS, getShortcutKeys } from '../../hooks';

/** Where problems go. There is no support desk; the issue tracker is it. */
const ISSUES_URL = 'https://github.com/Jackicus/Local-Mesh/issues';

export const HelpView: React.FC = () => {
  return (
    <div className="view-container">
      <header className="view-header">
        <h1 className="view-title">Help</h1>
        <p className="view-description">
          How to make your first mesh, and what to do if one does not come out.
        </p>
      </header>

      <div className="view-list">
        {/* 1. Getting started */}
        <Card
          title="Getting started"
          subtitle="Four steps to your first mesh"
          icon={<SparklesIcon size={20} />}
        >
          <ul className="guide-list">
            <li>
              <CheckCircleIcon size={16} className="guide-check" />
              <span>
                <strong>1. Install a model on the Models screen.</strong> It is a big download, so it can take a
                while, but you only do it once.
              </span>
            </li>
            <li>
              <CheckCircleIcon size={16} className="guide-check" />
              <span>
                <strong>2. Drag a picture in.</strong> Drop any photo onto the Generate screen and it becomes a
                job in the queue, named after the picture.
              </span>
            </li>
            <li>
              <CheckCircleIcon size={16} className="guide-check" />
              <span>
                <strong>3. Press Start.</strong> The queue runs top to bottom, and each shape appears in the
                window as it finishes.
              </span>
            </li>
            <li>
              <CheckCircleIcon size={16} className="guide-check" />
              <span>
                <strong>4. Tidy it up, then save it.</strong> Use the Edit tools on a finished job — you can step
                back through every change — and save the one you want to keep.
              </span>
            </li>
          </ul>
        </Card>

        {/* 2. Keyboard shortcuts */}
        <Card
          title="Keyboard Shortcuts"
          subtitle="Quick desktop shortcuts for navigating the application"
          icon={<KeyboardIcon size={20} />}
          action={
            <Badge variant="neutral">
              {APP_SHORTCUTS.length} Shortcuts
            </Badge>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {APP_SHORTCUTS.map((shortcut) => (
              <div key={shortcut.id} className="shortcut-row">
                <span>{shortcut.description}</span>
                <kbd>{shortcut.keys}</kbd>
              </div>
            ))}
          </div>
        </Card>

        {/* 3. If something goes wrong */}
        <Card
          title="If something goes wrong"
          subtitle="Where to look first"
          icon={<AlertCircleIcon size={20} />}
        >
          <ul className="guide-list">
            <li>
              <AlertCircleIcon size={16} className="guide-check" />
              <span>
                The Logs panel at the bottom of the window (<kbd>{getShortcutKeys('toggle-logs') || 'Ctrl + J'}</kbd>)
                shows what Local Mesh was doing and where it stopped.
              </span>
            </li>
            <li>
              <AlertCircleIcon size={16} className="guide-check" />
              <span>
                A misshapen mesh usually means the picture was hard to read. One clear object on a plain
                background works best.
              </span>
            </li>
            <li>
              <AlertCircleIcon size={16} className="guide-check" />
              <span>
                A run that stops partway usually means the graphics card ran out of memory. A smaller model on the
                Models screen will normally finish.
              </span>
            </li>
          </ul>
        </Card>

        {/* 4. Support */}
        <Card
          title="Still stuck"
          subtitle="Report it on GitHub"
          icon={<HelpIcon size={20} />}
          action={
            <Button
              size="sm"
              variant="secondary"
              icon={<ExternalLinkIcon size={14} />}
              onClick={() => void window.electronAPI?.openExternal(ISSUES_URL)}
            >
              Report a problem
            </Button>
          }
        >
          <p className="setting-description">
            Reloading the window with <kbd>{getShortcutKeys('reload-window') || 'Ctrl + R'}</kbd> is safe and clears
            most oddities. If that does not help, open an issue, say what you were doing, and paste the last few
            lines from the Logs panel.
          </p>
        </Card>
      </div>
    </div>
  );
};
