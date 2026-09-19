import React from 'react';
import { useDockStore } from '../stores/dockStore';
import { TopBar } from './TopBar';
import { LeftDock } from './LeftDock';
import { BottomDock } from './BottomDock';
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
  const [dock] = useDockStore();
  // Full-bleed views (Generate, Pipelines) read this to keep their floating
  // plates clear of the log dock. Closed, the dock is not rendered at all, so
  // the views get the whole content area back.
  const bottomInset = dock.bottom.isOpen ? dock.bottom.height : 0;
  return (
    <div className="app-shell" style={{ '--bottomdock-height': `${bottomInset}px` } as React.CSSProperties}>
      {/* The bar's colour, painted below the dock so the dock column rises to
          the window's top edge; the TopBar itself is a transparent overlay */}
      <div className="titlebar-fill" />
      <LeftDock />
      <main className="shell-content">{children}</main>
      {/* Sibling of the content, not a child: it overlays instead of resizing it */}
      <BottomDock />
      <TopBar />
      <OverlayHost />
    </div>
  );
};
