import React from 'react';
import { Card, Badge, Button } from '../../components';
import {
  HelpIcon,
  KeyboardIcon,
  MailIcon,
  BookOpenIcon,
  CheckCircleIcon,
  SparklesIcon,
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
          How to get Local Mesh from a blank install to a first mesh, plus the project README, keyboard shortcuts,
          and where to look when something goes wrong.
        </p>
      </header>

      <div className="view-list">
        {/* 0. Getting started */}
        <Card
          title="Getting started"
          subtitle="Three steps from a blank install to a first mesh"
          icon={<SparklesIcon size={20} />}
        >
          <ul className="guide-list">
            <li>
              <CheckCircleIcon size={16} className="guide-check" />
              <span><strong>1. Set up the environment</strong> in <strong>Models</strong>: it needs <code>uv</code> on your PATH, then installs Python 3.11, torch (cu126) and the worker under <code>~/.local-mesh</code>.</span>
            </li>
            <li>
              <CheckCircleIcon size={16} className="guide-check" />
              <span><strong>2. Download a model</strong> from the same view. Hunyuan3D 2 mini is the recommended fit for an 8 GB card; Mock needs no download if you just want to see the queue work.</span>
            </li>
            <li>
              <CheckCircleIcon size={16} className="guide-check" />
              <span><strong>3. Drop an image in Generate.</strong> The job runs through the selected pipeline and the mesh appears in the viewer and under <code>outputs/</code>.</span>
            </li>
          </ul>
        </Card>

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
