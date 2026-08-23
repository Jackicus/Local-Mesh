import React, { useState, useEffect } from 'react';
import { Card, Button, Form, Badge, Modal, toast } from '../../components';
import { DatabaseIcon, RefreshIcon, AlertTriangleIcon } from '../../assets/icons';
import { useDockStore, DOCK_DEFAULT_WIDTH } from '../../stores/dockStore';
import { useTheme } from '../../stores/themeStore';

export const StorageTab: React.FC = () => {
  const [, store] = useDockStore();
  const [, themeActions] = useTheme();
  const [storageKeysCount, setStorageKeysCount] = useState(0);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);

  useEffect(() => {
    try {
      setStorageKeysCount(localStorage.length);
    } catch {}
  }, []);

  const handleConfirmReset = () => {
    localStorage.clear();
    store.setIsOpen(true);
    store.setWidth(DOCK_DEFAULT_WIDTH);
    store.setActiveItem('home');
    themeActions.reset();
    setStorageKeysCount(0);
    setIsResetModalOpen(false);
    toast.success('All local storage and application preferences reset to default!');
  };

  return (
    <div className="view-list">
      <Card
        title="Application Storage &amp; Cache"
        subtitle="Manage local browser and desktop cache preferences"
        icon={<DatabaseIcon size={20} />}
        action={
          <Badge variant="neutral">
            {storageKeysCount} Local Keys
          </Badge>
        }
      >
        <Form.Row
          label="Reset All Preferences"
          description="Clears persisted theme mode, accent color, font selections, and dock navigation state back to defaults"
        >
          <Button
            size="sm"
            variant="danger"
            icon={<RefreshIcon size={14} />}
            onClick={() => setIsResetModalOpen(true)}
          >
            Reset Everything
          </Button>
        </Form.Row>
      </Card>

      {/* Confirmation Modal */}
      <Modal
        isOpen={isResetModalOpen}
        onClose={() => setIsResetModalOpen(false)}
        title="Reset Application Preferences?"
        subtitle="This action will restore all default settings."
        icon={<AlertTriangleIcon size={20} />}
        size="sm"
      >
        <Modal.Body>
          <p>
            Are you sure you want to reset all stored preferences? This will clear your custom theme, accent colors, typography scaling, and dock layout.
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button
            size="sm"
            variant="subtle"
            onClick={() => setIsResetModalOpen(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={<RefreshIcon size={14} />}
            onClick={handleConfirmReset}
          >
            Confirm Reset
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};
