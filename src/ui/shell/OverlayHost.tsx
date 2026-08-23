import React from 'react';
import { ToastContainer, ContextMenu } from '../components';

export const OverlayHost: React.FC = () => {
  return (
    <>
      {/* Portal mount point for active Modal dialogs */}
      <div id="overlay-root" />

      {/* Global floating right-click context menu */}
      <ContextMenu />

      {/* Global floating toast notification stack */}
      <ToastContainer position="bottom-right" />
    </>
  );
};
