import React from 'react';
import { Card, Badge } from '../../components';
import { FolderTreeIcon } from '../../assets/icons';

export interface InventoryItem {
  name: string;
  note: React.ReactNode;
}

interface InventoryCardProps {
  path: string;
  items: InventoryItem[];
  subtitle?: string;
}

/**
 * The at-a-glance manifest that opens every Developer tab: one row per thing
 * the directory ships, in the same order as the demo cards below it.
 */
export const InventoryCard: React.FC<InventoryCardProps> = ({
  path,
  items,
  subtitle = 'Everything this directory ships right now',
}) => {
  return (
    <Card
      title={path}
      subtitle={subtitle}
      icon={<FolderTreeIcon size={20} />}
      action={<Badge variant="accent">{items.length}</Badge>}
    >
      <div className="inventory-list">
        {items.map((item) => (
          <div key={item.name} className="inventory-row">
            <code className="inventory-name">{item.name}</code>
            <span className="inventory-note">{item.note}</span>
          </div>
        ))}
      </div>
    </Card>
  );
};
