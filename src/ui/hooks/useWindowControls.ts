import { useState, useEffect } from 'react';

/**
 * Hook to manage Electron window actions (Minimize, Maximize, Close, Restore).
 * Works seamlessly in Electron and falls back gracefully when previewed in web browsers.
 */
export function useWindowControls() {
  const [isMaximized, setIsMaximized] = useState<boolean>(false);
  const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI);

  useEffect(() => {
    if (!isElectron || !window.electronAPI) return;
    let isMounted = true;

    // Check initial window maximized state
    window.electronAPI.isMaximized().then((maximized) => {
      if (isMounted) setIsMaximized(maximized);
    });

    // Listen for maximize/unmaximize window events
    const unsubscribe = window.electronAPI.onMaximizedChange((maximized) => {
      if (isMounted) setIsMaximized(maximized);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [isElectron]);

  const minimize = () => {
    window.electronAPI?.minimize();
  };

  const maximize = () => {
    window.electronAPI?.maximize();
  };

  const close = () => {
    window.electronAPI?.close();
  };

  return {
    isElectron,
    isMaximized,
    minimize,
    maximize,
    close,
  };
}
