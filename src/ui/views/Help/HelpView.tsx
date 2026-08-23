import React from 'react';
import { Card, Badge, Button } from '../../components';
import {
  HelpIcon,
  KeyboardIcon,
  MailIcon,
  BookOpenIcon,
} from '../../assets/icons';
import { APP_SHORTCUTS, getShortcutKeys } from '../../hooks';
import rootReadme from '../../../../README.md?raw';

export const HelpView: React.FC = () => {
  return (
    <div className="view-container">
      <header className="view-header">
        <Badge variant="accent" icon={<HelpIcon size={14} />}>
          Documentation &amp; Assistance
        </Badge>
        <h1 className="view-title">Help &amp; Support</h1>
        <p className="view-description">
          Application documentation, user keyboard shortcuts, and support resources.
        </p>
      </header>

      <div className="view-list">
        {/* 1. Project Overview / Root README Display */}
        <Card
          title="Project Documentation &amp; Overview"
          subtitle="Displaying repository root README.md"
          icon={<BookOpenIcon size={20} />}
        >
          <div className="readme-view-container">
            <pre className="readme-content">{rootReadme}</pre>
          </div>
        </Card>

        {/* 2. User Keyboard Shortcuts */}
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

        {/* 3. Support & Assistance */}
        <Card
          title="Support &amp; Troubleshooting"
          subtitle="Need assistance or have feedback?"
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
            If you encounter any issues, try reloading the window with <kbd>{getShortcutKeys('reload-window') || 'Ctrl + R'}</kbd> or clearing local preferences under <strong>Settings &gt; Storage &amp; Data</strong>.
          </p>
        </Card>
      </div>
    </div>
  );
};
