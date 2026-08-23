import React from 'react';
import { Shell } from './shell/Shell';
import { ViewContainer } from './views';
import { ErrorBoundary } from './components';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { dockStore } from './stores/dockStore';

export const App: React.FC = () => {
  // Enable global desktop shortcuts (e.g. Ctrl+B to toggle left dock)
  useKeyboardShortcuts();

  return (
    <ErrorBoundary onReset={() => dockStore.setActiveItem('home')}>
      <Shell>
        <ErrorBoundary onReset={() => dockStore.setActiveItem('home')}>
          <ViewContainer />
        </ErrorBoundary>
      </Shell>
    </ErrorBoundary>
  );
};

export default App;
