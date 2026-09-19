import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { OutputItem } from '../../../core/types';
import { Button, Modal, toast } from '../../components';
import { FolderOpenIcon, RefreshIcon, TrashIcon } from '../../assets/icons';
import { api } from '../../stores/createStore';
import { useEnvStore } from '../../stores/envStore';
import { useGenerationStore } from '../../stores/generationStore';
import { formatBytes, formatWhen } from './format';
import { useViewerStore, viewerStore } from './viewerStore';

/** Everything on disk under outputs/, newest first (main sorts it). */
export const OutputsPanel: React.FC = () => {
  const [gen] = useGenerationStore();
  const [viewer] = useViewerStore();
  const [env] = useEnvStore();
  const [items, setItems] = useState<OutputItem[]>([]);
  const [pendingDelete, setPendingDelete] = useState<OutputItem | null>(null);
  const outputs = env.paths?.outputs;

  // Finished jobs are the only thing that adds files behind our back.
  const finishedCount = gen.jobs.filter((j) => j.status === 'done').length;

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
    // outputsRevision covers the files the mesh tools write behind our back.
  }, [refresh, finishedCount, viewer.outputsRevision]);

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
        <span className="gen-panel-title">Outputs</span>
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
        <p className="gen-blank">No meshes yet. Generate one and it lands here.</p>
      ) : (
        <ul className="gen-output-list">
          {items.map((item) => (
            <li key={item.path} className={`gen-output ${viewer.loaded?.path === item.path ? 'is-loaded' : ''}`}>
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
        Open outputs folder
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
