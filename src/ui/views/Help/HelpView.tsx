import React from 'react';
import { Card, Badge, Button } from '../../components';
import {
  KeyboardIcon,
  MailIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  SparklesIcon,
} from '../../assets/icons';
import { APP_SHORTCUTS, getShortcutKeys } from '../../hooks';

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
          subtitle="Three steps to your first mesh"
          icon={<SparklesIcon size={20} />}
        >
          <ul className="guide-list">
            <li>
              <CheckCircleIcon size={16} className="guide-check" />
              <span>
                <strong>1. Press Install on the Generate screen</strong> and let it finish. It is a big download,
                so it can take a while, but you only do it once.
              </span>
            </li>
            <li>
              <CheckCircleIcon size={16} className="guide-check" />
              <span>
                <strong>2. Drag a picture in.</strong> Drop any photo onto the Generate screen.
              </span>
            </li>
            <li>
              <CheckCircleIcon size={16} className="guide-check" />
              <span>
                <strong>3. Press Generate.</strong> The 3D shape appears in the window when it is ready, and you
                can save it from there.
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
          subtitle="Get in touch"
          icon={<MailIcon size={20} />}
          action={
            <Button
              size="sm"
              variant="secondary"
              icon={<MailIcon size={14} />}
              onClick={() => window.open('mailto:support@example.com')}
            >
              Contact Support
            </Button>
          }
        >
          <p className="setting-description">
            Reloading the window with <kbd>{getShortcutKeys('reload-window') || 'Ctrl + R'}</kbd> is safe and clears
            most oddities. If that does not help, send us a note and say what you were doing.
          </p>
        </Card>
      </div>
    </div>
  );
};
