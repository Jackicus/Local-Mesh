import React, { useEffect } from 'react';
import { Shell } from './shell/Shell';
import { ViewContainer } from './views';
import { ErrorBoundary } from './components';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { dockStore } from './stores/dockStore';
import { generationStore, useGenerationStore } from './stores/generationStore';
import { modelStore } from './stores/modelStore';
import { envStore } from './stores/envStore';
import { pipelineStore } from './stores/pipelineStore';
import { logStore } from './stores/logStore';
import { settingsStore } from './stores/settingsStore';

export const App: React.FC = () => {
  // Enable global desktop shortcuts (e.g. Ctrl+B to toggle left dock)
  useKeyboardShortcuts();

  // The node editor stays out of the nav until the app has demonstrably
  // worked. One finished mesh is the moment the advanced tools stop being
  // noise and start being the obvious next thing to look at.
  const [gen] = useGenerationStore();
  useEffect(() => {
    if (gen.jobs.some((job) => job.status === 'done')) dockStore.setAdvanced(true);
  }, [gen.jobs]);

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

  // A file dropped anywhere outside a real drop target is otherwise handled by
  // Electron, which navigates the renderer to that file and takes the running
  // app with it. The Generate view's own handlers run first on the way up.
  useEffect(() => {
    const swallow = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    return () => {
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
    };
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
