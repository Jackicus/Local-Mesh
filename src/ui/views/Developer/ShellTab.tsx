import React from 'react';
import { Card, Badge, Form, Button } from '../../components';
import { LayoutIcon } from '../../assets/icons';
import { useDockStore, DOCK_MIN_WIDTH, DOCK_MAX_WIDTH } from '../../stores/dockStore';
import { ClaudeMdCard } from './ClaudeMdCard';
import { InventoryCard } from './InventoryCard';

export const ShellTab: React.FC = () => {
  const [dockState, dockActions] = useDockStore();

  return (
    <div className="view-list">
      <InventoryCard
        path="src/ui/shell"
        items={[
          { name: 'Shell', note: 'the outer frame — no app-wide right-click menu; elements attach their own' },
          { name: 'TopBar', note: 'draggable window header (40px) with the dock toggle and title' },
          { name: 'LeftDock', note: `resizable nav, ${DOCK_MIN_WIDTH}–${DOCK_MAX_WIDTH}px, collapses to a 56px icon rail` },
          { name: 'WindowControls', note: 'minimize / maximize / close buttons, wired over IPC' },
          { name: 'OverlayHost', note: 'the single mount point for modals, toasts, menus, and tooltips' },
        ]}
      />

      <Card
        title="LeftDock"
        subtitle="Drive the live dock from here"
        icon={<LayoutIcon size={20} />}
        action={
          <Badge variant={dockState.isOpen ? 'accent' : 'neutral'}>
            {dockState.isOpen ? `${dockState.width}px` : 'Collapsed'}
          </Badge>
        }
      >
        <Form.Row label="Width" description={`Clamped to ${DOCK_MIN_WIDTH}–${DOCK_MAX_WIDTH}px — the edge is also drag-resizable`}>
          <Form.Slider
            min={DOCK_MIN_WIDTH}
            max={DOCK_MAX_WIDTH}
            value={dockState.width}
            onChange={(val) => dockActions.setWidth(val)}
            unit="px"
            ariaLabel="Dock Width"
          />
        </Form.Row>
        <Form.Row label="Collapse" description="Same action as Ctrl/Cmd + B or the top-bar toggle">
          <Button size="sm" variant="secondary" onClick={() => dockActions.toggle()}>
            {dockState.isOpen ? 'Collapse' : 'Expand'}
          </Button>
        </Form.Row>
      </Card>

      <ClaudeMdCard dir="shell" />
    </div>
  );
};
