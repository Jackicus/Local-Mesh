import React from 'react';
import { useDockStore } from '../stores/dockStore';
import { HomeView } from './Home';
import { NotesView } from './Notes';
import { DeveloperView } from './Developer';
import { SettingsView } from './Settings';
import { HelpView } from './Help';

/**
 * Master View Router Component.
 * Automatically switches the active view based on dock navigation selection.
 * To add a new view: create a new folder in src/ui/views/MyView/ and register a case below!
 */
export const ViewContainer: React.FC = () => {
  const [dockState] = useDockStore();

  switch (dockState.activeItem) {
    case 'notes':
      return <NotesView />;
    case 'developer':
      return <DeveloperView />;
    case 'settings':
      return <SettingsView />;
    case 'help':
      return <HelpView />;
    case 'home':
    default:
      return <HomeView />;
  }
};

export * from './Home';
export * from './Notes';
export * from './Developer';
export * from './Settings';
export * from './Help';
