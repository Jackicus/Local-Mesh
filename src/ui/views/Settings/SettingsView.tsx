import React, { useState } from 'react';
import { Badge, Form } from '../../components';
import { SettingsIcon, PaletteIcon, DatabaseIcon } from '../../assets/icons';
import { AppearanceTab } from './AppearanceTab';
import { StorageTab } from './StorageTab';

export type SettingsTabId = 'appearance' | 'storage';

export const SettingsView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('appearance');

  return (
    <div className="view-container">
      <header className="view-header">
        <Badge variant="accent" icon={<SettingsIcon size={14} />}>
          Configuration
        </Badge>
        <h1 className="view-title">Settings &amp; Preferences</h1>
        <p className="view-description">
          Customize appearance themes, fonts, and manage local data.
        </p>

        {/* Sub-navigation bar spanning the full width of the cards below */}
        <div className="view-subnav">
          <Form.Segmented
            fullWidth
            value={activeTab}
            onChange={(tab) => setActiveTab(tab as SettingsTabId)}
            options={[
              {
                value: 'appearance',
                label: 'Appearance',
                icon: <PaletteIcon size={14} />,
              },
              {
                value: 'storage',
                label: 'Storage & Data',
                icon: <DatabaseIcon size={14} />,
              },
            ]}
          />
        </div>
      </header>

      {/* Render Active Sub-Page */}
      {activeTab === 'appearance' && <AppearanceTab />}
      {activeTab === 'storage' && <StorageTab />}
    </div>
  );
};
