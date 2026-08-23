import React from 'react';
import { Card, Button, Form } from '../../components';
import { DatabaseIcon, RefreshIcon, PaletteIcon } from '../../assets/icons';
import { useDockStore } from '../../stores/dockStore';
import { useTheme, AVAILABLE_ACCENTS } from '../../stores/themeStore';
import { ClaudeMdCard } from './ClaudeMdCard';
import { InventoryCard } from './InventoryCard';

export const StoresTab: React.FC = () => {
  const [dockState, dockActions] = useDockStore();
  const [themeState, themeActions] = useTheme();

  const handleCycleAccent = () => {
    const currentIndex = AVAILABLE_ACCENTS.findIndex((a) => a.id === themeState.accent);
    const nextIndex = (currentIndex + 1) % AVAILABLE_ACCENTS.length;
    themeActions.setAccent(AVAILABLE_ACCENTS[nextIndex].id);
  };

  return (
    <div className="view-list">
      <InventoryCard
        path="src/ui/stores"
        subtitle="Every store in the app — two here, two living beside their components"
        items={[
          { name: 'dockStore', note: 'dock open state, width, and the active view; in-memory by design' },
          { name: 'themeStore', note: 'mode, accent, font, and scale; persisted to localStorage' },
          { name: 'Toast/toastStore', note: 'toast stack; lives beside the Toast component' },
          { name: 'ContextMenu/…', note: <><code>contextMenuStore</code> — open menu state, beside its component</> },
        ]}
      />

      <Card
        title="dockStore"
        subtitle="Live state — interact with the dock or press the buttons"
        icon={<DatabaseIcon size={20} />}
      >
        <Form.Row label="Actions" description="Store methods, called directly">
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Button size="sm" variant="secondary" onClick={() => dockActions.toggle()}>
              {dockState.isOpen ? 'Collapse Dock' : 'Expand Dock'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => dockActions.setWidth(dockState.width === 240 ? 300 : 240)}
            >
              Toggle Width ({dockState.width}px)
            </Button>
          </div>
        </Form.Row>
        <pre className="state-dump">{JSON.stringify(dockState, null, 2)}</pre>
      </Card>

      <Card
        title="themeStore"
        subtitle="Live state — cycle the accent or change theme in Settings"
        icon={<PaletteIcon size={20} />}
      >
        <Form.Row label="Actions" description="Cycle through the accent pigments">
          <Button size="sm" variant="secondary" icon={<RefreshIcon size={14} />} onClick={handleCycleAccent}>
            Next Accent ({themeState.accent})
          </Button>
        </Form.Row>
        <pre className="state-dump">{JSON.stringify(themeState, null, 2)}</pre>
      </Card>

      <ClaudeMdCard dir="stores" />
    </div>
  );
};
