import React from 'react';
import { TopBar } from './TopBar';
import { LeftDock } from './LeftDock';
import { OverlayHost } from './OverlayHost';

interface ShellProps {
  children: React.ReactNode;
}

/**
 * The window frame. There is no app-wide right-click menu on purpose: empty
 * space has nothing to act on. Elements with real actions attach their own
 * via contextMenu.open(event, items) — see the ContextMenu demo in Developer.
 */
export const Shell: React.FC<ShellProps> = ({ children }) => {
  return (
    <div className="app-shell">
      {/* The bar's colour, painted below the dock so the dock column rises to
          the window's top edge; the TopBar itself is a transparent overlay */}
      <div className="titlebar-fill" />
      <LeftDock />
      <main className="shell-content">{children}</main>
      <TopBar />
      <OverlayHost />
    </div>
  );
};
