import React, { useEffect } from 'react';
import { Shell } from './shell/Shell';
import { ViewContainer } from './views';
import { ErrorBoundary } from './components';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { dockStore } from './stores/dockStore';
import { generationStore } from './stores/generationStore';
import { modelStore } from './stores/modelStore';
import { envStore } from './stores/envStore';
import { pipelineStore } from './stores/pipelineStore';
import { logStore } from './stores/logStore';
import { settingsStore } from './stores/settingsStore';

export const App: React.FC = () => {
  // Enable global desktop shortcuts (e.g. Ctrl+B to toggle left dock)
  useKeyboardShortcuts();

  // Wire every main-process-backed store once. Each bind() is idempotent and
  // a no-op in a plain browser, where window.electronAPI is undefined.
  useEffect(() => {
    settingsStore.bind();
    logStore.bind();
    envStore.bind();
    modelStore.bind();
    pipelineStore.bind();
    generationStore.bind();
  }, []);

  return (
    <ErrorBoundary onReset={() => dockStore.setActiveItem('generate')}>
      <Shell>
        <ErrorBoundary onReset={() => dockStore.setActiveItem('generate')}>
          <ViewContainer />
        </ErrorBoundary>
      </Shell>
    </ErrorBoundary>
  );
};

export default App;
