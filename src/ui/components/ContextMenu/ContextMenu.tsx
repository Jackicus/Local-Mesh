import React, { useEffect, useRef } from 'react';
import { useContextMenuStore } from './contextMenuStore';

export const ContextMenu: React.FC = () => {
  const [state, store] = useContextMenuStore();
  const menuRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!state.isOpen) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        store.close();
      }
    };

    // Menus are opened by pointer but must be operable from the keyboard once
    // open: move focus in, walk it with the arrows, hand it back on close
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const items = () =>
      Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>(
          '.ui-context-menu-item:not([disabled])'
        ) ?? []
      );
    items()[0]?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        store.close();
        return;
      }
      const focusable = items();
      if (focusable.length === 0) return;
      const index = focusable.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault();
        focusable[(index + 1 + focusable.length) % focusable.length].focus();
      } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
        e.preventDefault();
        focusable[(index - 1 + focusable.length) % focusable.length].focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        focusable[0].focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        focusable[focusable.length - 1].focus();
      }
    };

    const handleScroll = () => {
      store.close();
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      if (target && target.isConnected) target.focus?.();
    };
  }, [state.isOpen, store]);

  if (!state.isOpen) return null;

  return (
    <div
      ref={menuRef}
      className="ui-context-menu"
      style={{
        position: 'fixed',
        left: `${state.x}px`,
        top: `${state.y}px`,
        zIndex: 'var(--z-context-menu)',
      }}
      role="menu"
    >
      {state.items.map((item, idx) => {
        if (item.separator) {
          return <div key={`sep-${idx}`} className="ui-context-menu-separator" role="separator" />;
        }

        return (
          <button
            key={item.id ?? `item-${idx}`}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={`ui-context-menu-item ${item.danger ? 'danger' : ''}`}
            onClick={() => {
              if (!item.disabled) {
                store.close();
                item.onClick?.();
              }
            }}
          >
            {item.icon && <span className="ui-context-menu-icon">{item.icon}</span>}
            <span className="ui-context-menu-label">{item.label}</span>
            {item.shortcut && (
              <span className="ui-context-menu-shortcut">{item.shortcut}</span>
            )}
          </button>
        );
      })}
    </div>
  );
};
