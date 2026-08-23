import React from 'react';
import { Card, Badge, Button } from '../../components';
import {
  SparklesIcon,
  CheckCircleIcon,
  CodeIcon,
  PaletteIcon,
  HelpIcon,
  LayersIcon,
  ZapIcon,
} from '../../assets/icons';
import { dockStore } from '../../stores/dockStore';

export const HomeView: React.FC = () => {
  return (
    <div className="view-container">
      {/* 1. Header Banner */}
      <header className="view-header">
        <Badge variant="accent" icon={<SparklesIcon size={14} />}>
          Starter Template
        </Badge>
        <h1 className="view-title">Welcome</h1>
        <p className="view-description">
          A desktop starter built on Electron, React, Vite, and TypeScript. Replace this view with your app.
        </p>
      </header>

      {/* 2. Quick Action Jump Cards */}
      <div className="view-grid">
        <Card
          title="Developer Tools"
          subtitle="Component playground and architecture notes"
          icon={<CodeIcon size={20} />}
        >
          <p className="setting-description">
            Live demos of every UI primitive, plus short guides to the hooks, stores, and shell that ship with the template.
          </p>
          <Card.Footer>
            <Button
              size="sm"
              variant="primary"
              icon={<CodeIcon size={14} />}
              onClick={() => dockStore.setActiveItem('developer')}
            >
              Open Workspace
            </Button>
          </Card.Footer>
        </Card>

        <Card
          title="Appearance &amp; Theme"
          subtitle="Theme mode, accent color, and fonts"
          icon={<PaletteIcon size={20} />}
        >
          <p className="setting-description">
            Switch between system, light, and dark modes, pick an accent color, and adjust the interface font and scale.
          </p>
          <Card.Footer>
            <Button
              size="sm"
              variant="secondary"
              icon={<PaletteIcon size={14} />}
              onClick={() => dockStore.setActiveItem('settings')}
            >
              Customize Theme
            </Button>
          </Card.Footer>
        </Card>

        <Card
          title="Help &amp; Shortcuts"
          subtitle="Keyboard shortcuts and the project README"
          icon={<HelpIcon size={20} />}
        >
          <p className="setting-description">
            The keyboard shortcut list (with OS-specific keys) and the repository README, viewable in-app.
          </p>
          <Card.Footer>
            <Button
              size="sm"
              variant="secondary"
              icon={<HelpIcon size={14} />}
              onClick={() => dockStore.setActiveItem('help')}
            >
              View Documentation
            </Button>
          </Card.Footer>
        </Card>
      </div>

      {/* 3. Technology Stack */}
      <Card
        title="Stack"
        subtitle="What this template is built on"
        icon={<ZapIcon size={20} />}
      >
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <Badge variant="accent">Electron</Badge>
          <Badge variant="accent">React</Badge>
          <Badge variant="neutral">Vite</Badge>
          <Badge variant="neutral">TypeScript</Badge>
          <Badge variant="neutral">Plain CSS (@layer, OKLCH)</Badge>
          <Badge variant="neutral">No state library</Badge>
        </div>
      </Card>

      {/* 4. Getting Started Guide */}
      <Card
        title="Adding Your First Screen"
        subtitle="The three steps to a new view"
        icon={<LayersIcon size={20} />}
      >
        <ul className="guide-list">
          <li>
            <CheckCircleIcon size={16} className="guide-check" />
            <span><strong>Create a view:</strong> Add a folder in <code>src/ui/views/MyScreen/</code> and export a component from its <code>index.ts</code>.</span>
          </li>
          <li>
            <CheckCircleIcon size={16} className="guide-check" />
            <span><strong>Register it:</strong> Add a case for it in <code>src/ui/views/index.tsx</code> and a nav entry in <code>src/ui/shell/LeftDock.tsx</code>.</span>
          </li>
          <li>
            <CheckCircleIcon size={16} className="guide-check" />
            <span><strong>Build with the primitives:</strong> <code>Card</code>, <code>Form</code>, <code>Modal</code>, <code>Toast</code>, and <code>Tooltip</code> are ready to compose — no UI kit needed.</span>
          </li>
        </ul>
      </Card>
    </div>
  );
};
