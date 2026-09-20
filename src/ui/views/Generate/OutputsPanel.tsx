import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { OutputItem } from '../../../core/types';
import { Button, Modal, toast } from '../../components';
import { FolderOpenIcon, RefreshIcon, TrashIcon } from '../../assets/icons';
import { api } from '../../stores/createStore';
import { useEnvStore } from '../../stores/envStore';
import { useGenerationStore } from '../../stores/generationStore';
import { formatBytes, formatWhen } from './format';
import { useViewerStore, viewerStore } from './viewerStore';

/**
 * The outputs folder, newest first (main sorts it).
 *
 * This is now genuinely "meshes I kept": generating writes into a job's cache,
 * and only Save copies one out here. So a short list is not a sign that
 * nothing has run — it is the list of things someone decided to keep, which is
 * what the empty state says.
 *
 * Opening one is a preview, not a selection: the file no longer belongs to a
 * job, so the Edit plate must not offer to revise it.
 */
export const OutputsPanel: React.FC = () => {
  const [gen] = useGenerationStore();
  const [viewer] = useViewerStore();
  const [env] = useEnvStore();
  const [items, setItems] = useState<OutputItem[]>([]);
  const [pendingDelete, setPendingDelete] = useState<OutputItem | null>(null);
  const outputs = env.paths?.outputs;

  // Saving is the only thing that adds a file behind our back, and the job it
  // came from leaves the queue at the same moment — so the count of jobs is no
  // signal at all and the store keeps a tick instead.
  const savedTick = gen.savedTick;

  // The panel unmounts whenever its plate closes, and two reads can land out
  // of order; only the newest one is allowed to write.
  const readToken = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const token = ++readToken.current;
    const list = (await api()?.listOutputs()) ?? [];
    if (alive.current && token === readToken.current) setItems(list);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, savedTick]);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const { path, name } = pendingDelete;
    setPendingDelete(null);
    try {
      await api()?.deleteOutput(path);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), { title: `Could not delete ${name}` });
      return;
    } finally {
      void refresh();
    }
    viewerStore.forget(path);
  };

  return (
    <div className="gen-outputs">
      <header className="gen-panel-head">
        <span className="gen-panel-title">Saved</span>
        <span className="gen-panel-meta">{items.length}</span>
        <button
          type="button"
          className="gen-panel-action"
          aria-label="Refresh outputs"
          title="Refresh"
          onClick={() => void refresh()}
        >
          <RefreshIcon size={13} />
        </button>
      </header>

      {items.length === 0 ? (
        <p className="gen-blank">Nothing saved yet. Save a finished job and it lands here.</p>
      ) : (
        <ul className="gen-output-list">
          {items.map((item) => (
            <li key={item.path} className={`gen-output ${viewer.loaded?.path === item.path ? 'is-loaded' : ''}`}>
              <button
                type="button"
                className="gen-output-open"
                title={item.path}
                onClick={() => void viewerStore.preview(item.path)}
              >
                <span className="gen-output-name">{item.name}</span>
                <span className="gen-output-meta">
                  {formatBytes(item.sizeBytes)} · {formatWhen(item.createdAt)}
                </span>
              </button>
              <button
                type="button"
                className="gen-panel-action"
                aria-label={`Delete ${item.name}`}
                title="Delete"
                onClick={() => setPendingDelete(item)}
              >
                <TrashIcon size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Button
        variant="secondary"
        size="sm"
        fullWidth
        icon={<FolderOpenIcon size={13} />}
        disabled={!outputs}
        onClick={() => outputs && void api()?.openPath(outputs)}
      >
        Open the folder
      </Button>

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
    </div>
  );
};
