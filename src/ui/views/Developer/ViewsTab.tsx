import React from 'react';
import { Card } from '../../components';
import { CheckCircleIcon, SparklesIcon } from '../../assets/icons';
import { ClaudeMdCard } from './ClaudeMdCard';
import { InventoryCard } from './InventoryCard';

export const ViewsTab: React.FC = () => {
  return (
    <div className="view-list">
      <InventoryCard
        path="src/ui/views"
        subtitle="Every registered screen — the router is a plain switch in index.tsx"
        items={[
          { name: 'Generate', note: 'full-bleed: drop images, pick a pipeline, watch the queue and preview meshes' },
          { name: 'Pipelines', note: 'node-graph editor for image → mesh pipelines saved under ~/.local-mesh/pipelines' },
          { name: 'Models', note: 'Python environment status/setup and the model registry with download, load, delete' },
          { name: 'Logs', note: 'not a view — LogsPanel lives in the shell bottom dock (Ctrl/Cmd + J)' },
          { name: 'Developer', note: 'this view — six tabs, one per src/ui directory' },
          { name: 'Settings', note: 'Appearance, Generation (device, precision, idle unload) and Storage tabs' },
          { name: 'Help', note: 'getting-started guide, keyboard shortcuts and the repo README, in-app' },
        ]}
      />

      <Card
        title="Adding a View"
        subtitle="A new screen in three steps"
        icon={<SparklesIcon size={20} />}
      >
        <ul className="guide-list">
          <li>
            <CheckCircleIcon size={16} className="guide-check" />
            <span><strong>1. Create the folder:</strong> <code>src/ui/views/MyView/MyView.tsx</code> plus an <code>index.ts</code>.</span>
          </li>
          <li>
            <CheckCircleIcon size={16} className="guide-check" />
            <span><strong>2. Register it:</strong> add a case in <code>src/ui/views/index.tsx</code>.</span>
          </li>
          <li>
            <CheckCircleIcon size={16} className="guide-check" />
            <span><strong>3. Add navigation:</strong> a nav item in <code>src/ui/shell/LeftDock.tsx</code>. For sub-tabs, switch sub-pages with <code>Form.Segmented</code> like this view does.</span>
          </li>
        </ul>
      </Card>

      <ClaudeMdCard dir="views" />
    </div>
  );
};
