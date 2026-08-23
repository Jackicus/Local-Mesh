import React, { useEffect, useRef } from 'react';
import { useContextMenuStore } from './contextMenuStore';

export const ContextMenu: React.FC = () => {
  const [state, store] = useContextMenuStore();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state.isOpen) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        store.close();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        store.close();
      }
    };

    const handleScroll = () => {
      store.close();
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll, true);
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
