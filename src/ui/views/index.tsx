import React from 'react';
import { useDockStore } from '../stores/dockStore';
import { GenerateView } from './Generate';
import { PipelinesView } from './Pipelines';
import { ModelsView } from './Models';
import { DeveloperView } from './Developer';
import { SettingsView } from './Settings';
import { HelpView } from './Help';

/**
 * Master View Router Component.
 * Switches the active view based on dock navigation selection.
 * To add a new view: create a folder in src/ui/views/MyView/ and register a case below.
 */
export const ViewContainer: React.FC = () => {
  const [dockState] = useDockStore();

  switch (dockState.activeItem) {
    case 'pipelines':
      return <PipelinesView />;
    case 'models':
      return <ModelsView />;
    case 'developer':
      return <DeveloperView />;
    case 'settings':
      return <SettingsView />;
    case 'help':
      return <HelpView />;
    case 'generate':
    default:
      return <GenerateView />;
  }
};

export * from './Generate';
export * from './Pipelines';
export * from './Models';
export * from './Developer';
export * from './Settings';
export * from './Help';
