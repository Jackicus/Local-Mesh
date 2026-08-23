import React, { useState } from 'react';
import { Badge, Form } from '../../components';
import {
  CodeIcon,
  LayersIcon,
  FolderIcon,
  SlidersIcon,
  DatabaseIcon,
  LayoutIcon,
  CompassIcon,
} from '../../assets/icons';
import { ComponentsTab } from './ComponentsTab';
import { AssetsTab } from './AssetsTab';
import { HooksTab } from './HooksTab';
import { StoresTab } from './StoresTab';
import { ShellTab } from './ShellTab';
import { ViewsTab } from './ViewsTab';

export type DeveloperTabId =
  | 'components'
  | 'assets'
  | 'hooks'
  | 'stores'
  | 'shell'
  | 'views';

export const DeveloperView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<DeveloperTabId>('components');

  return (
    <div className="view-container">
      <header className="view-header">
        <Badge variant="accent" icon={<CodeIcon size={14} />}>
          Developer Workspace
        </Badge>

        <h1 className="view-title">Developer Tools</h1>
        <p className="view-description">
          A live inventory of <code>src/ui</code> — each tab lists what its directory ships, then demos it.
        </p>

        {/* Sub-navigation bar spanning the full width of the cards below */}
        <div className="view-subnav">
          <Form.Segmented
            fullWidth
            value={activeTab}
            onChange={(tab) => setActiveTab(tab as DeveloperTabId)}
            options={[
                {
                  value: 'components',
                  label: 'Components',
                  icon: <LayersIcon size={14} />,
                },
                {
                  value: 'assets',
                  label: 'Assets',
                  icon: <FolderIcon size={14} />,
                },
                {
                  value: 'hooks',
                  label: 'Hooks',
                  icon: <SlidersIcon size={14} />,
                },
                {
                  value: 'stores',
                  label: 'Stores',
                  icon: <DatabaseIcon size={14} />,
                },
                {
                  value: 'shell',
                  label: 'Shell',
                  icon: <LayoutIcon size={14} />,
                },
                {
                  value: 'views',
                  label: 'Views',
                  icon: <CompassIcon size={14} />,
                },
              ]}
            />
          </div>
      </header>

      {/* Render Selected Sub-Page */}
      {activeTab === 'components' && <ComponentsTab />}
      {activeTab === 'assets' && <AssetsTab />}
      {activeTab === 'hooks' && <HooksTab />}
      {activeTab === 'stores' && <StoresTab />}
      {activeTab === 'shell' && <ShellTab />}
      {activeTab === 'views' && <ViewsTab />}
    </div>
  );
};
