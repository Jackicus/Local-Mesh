import React, { useCallback, useEffect, useState } from 'react';
import type { OutputItem } from '../../../core/types';
import { Button, Modal } from '../../components';
import { RefreshIcon, TrashIcon } from '../../assets/icons';
import { api } from '../../stores/createStore';
import { useGenerationStore } from '../../stores/generationStore';
import { DockSection } from './DockSection';
import { formatBytes, formatWhen } from './format';
import { useViewerStore, viewerStore } from './viewerStore';

/** Everything on disk under outputs/, newest first (main sorts it). */
export const OutputList: React.FC = () => {
  const [gen] = useGenerationStore();
  const [viewer] = useViewerStore();
  const [items, setItems] = useState<OutputItem[]>([]);
  const [pendingDelete, setPendingDelete] = useState<OutputItem | null>(null);

  // Finished jobs are the only thing that adds files behind our back.
  const finishedCount = gen.jobs.filter((j) => j.status === 'done').length;

  const refresh = useCallback(async () => {
    const list = (await api()?.listOutputs()) ?? [];
    setItems(list);
  }, []);

  useEffect(() => {
    void refresh();
    // outputsRevision covers the files the mesh tools write behind our back.
  }, [refresh, finishedCount, viewer.outputsRevision]);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    await api()?.deleteOutput(pendingDelete.path);
    viewerStore.forget(pendingDelete.path);
    setPendingDelete(null);
    void refresh();
  };

  return (
    <DockSection
      title="Outputs"
      collapsible
      defaultOpen={false}
      meta={items.length || undefined}
      action={
        <Button
          variant="subtle"
          size="sm"
          className="btn-icon-only"
          aria-label="Refresh outputs"
          icon={<RefreshIcon size={13} />}
          onClick={() => void refresh()}
        />
      }
    >
      {items.length === 0 ? (
        <p className="gen-blank">No meshes yet.</p>
      ) : (
        <ul className="gen-output-list">
          {items.map((item) => (
            <li key={item.path} className="gen-output">
              <button
                type="button"
                className="gen-output-open"
                title={item.path}
                onClick={() => void viewerStore.load(item.path)}
              >
                <span className="gen-output-name">{item.name}</span>
                <span className="gen-output-meta">
                  {formatBytes(item.sizeBytes)} · {formatWhen(item.createdAt)}
                </span>
              </button>
              <Button
                variant="subtle"
                size="sm"
                className="btn-icon-only"
                aria-label={`Delete ${item.name}`}
                icon={<TrashIcon size={13} />}
                onClick={() => setPendingDelete(item)}
              />
            </li>
          ))}
        </ul>
      )}

      <Modal
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete mesh"
        size="sm"
      >
        <Modal.Body>
          <p>
            <code>{pendingDelete?.name}</code> will be removed from the outputs folder. This can&apos;t be
            undone.
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="subtle" onClick={() => setPendingDelete(null)}>
            Keep
          </Button>
          <Button variant="danger" onClick={confirmDelete}>
            Delete
          </Button>
        </Modal.Footer>
      </Modal>
    </DockSection>
  );
};
