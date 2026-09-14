import React, { useState } from 'react';
import type { PipelineSummary } from '../../../core/pipeline';
import { getModel } from '../../../core/models';
import { Badge, Button, Form, Modal, contextMenuStore } from '../../components';
import { CopyIcon, EditIcon, PlayIcon, TrashIcon } from '../../assets/icons';

export interface PipelineListProps {
  list: PipelineSummary[];
  /** The pipeline open in the editor. */
  editingId: string | null;
  /** The pipeline the Generate view will run. */
  selectedId: string | null;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onUseInGenerate: (id: string) => void;
  onDelete: (id: string) => void;
}

function relativeTime(ts: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

/** Saved pipelines as dock rows, plus the rename/delete dialogs they open. */
export const PipelineList: React.FC<PipelineListProps> = ({
  list,
  editingId,
  selectedId,
  onOpen,
  onRename,
  onDuplicate,
  onUseInGenerate,
  onDelete,
}) => {
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<PipelineSummary | null>(null);

  const openMenu = (e: React.MouseEvent, p: PipelineSummary) => {
    onOpen(p.id);
    contextMenuStore.open(e, [
      { id: 'rename', label: 'Rename…', icon: <EditIcon size={14} />, onClick: () => setRenaming({ id: p.id, name: p.name }) },
      { id: 'duplicate', label: 'Duplicate', icon: <CopyIcon size={14} />, onClick: () => onDuplicate(p.id) },
      {
        id: 'use',
        label: 'Use in Generate',
        icon: <PlayIcon size={14} />,
        disabled: p.id === selectedId,
        onClick: () => onUseInGenerate(p.id),
      },
      { separator: true, label: '' },
      { id: 'delete', label: 'Delete', icon: <TrashIcon size={14} />, danger: true, onClick: () => setDeleting(p) },
    ]);
  };

  const commitRename = () => {
    if (renaming && renaming.name.trim()) onRename(renaming.id, renaming.name);
    setRenaming(null);
  };

  return (
    <>
      <div className="pipe-list-rows">
        {list.length === 0 && <p className="pipe-list-empty">No pipelines saved yet.</p>}

        {list.map((p) => {
          const model = p.modelId ? getModel(p.modelId) : undefined;
          return (
            <button
              key={p.id}
              type="button"
              className={`pipe-list-row ${p.id === editingId ? 'editing' : ''}`}
              aria-current={p.id === editingId ? 'true' : undefined}
              onClick={() => onOpen(p.id)}
              onContextMenu={(e) => openMenu(e, p)}
            >
              <span className="pipe-list-row-top">
                <span className="pipe-list-name">{p.name}</span>
                {p.id === selectedId && (
                  <span className="pipe-list-active" title="Generate runs this pipeline">
                    Active
                  </span>
                )}
              </span>
              <span className="pipe-list-meta">
                <Badge variant={model ? 'neutral' : 'warning'}>{model?.name ?? 'No model'}</Badge>
                <span className="pipe-list-facts">
                  {p.nodeCount} {p.nodeCount === 1 ? 'node' : 'nodes'} · {relativeTime(p.updatedAt)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <Modal
        isOpen={renaming !== null}
        onClose={() => setRenaming(null)}
        title="Rename pipeline"
        icon={<EditIcon size={18} />}
        size="sm"
      >
        <Modal.Body>
          <Form.Input
            autoFocus
            value={renaming?.name ?? ''}
            aria-label="Pipeline name"
            className="pipe-rename-input"
            onChange={(e) => setRenaming((r) => (r ? { ...r, name: e.target.value } : r))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
            }}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button size="sm" variant="subtle" onClick={() => setRenaming(null)}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={!renaming?.name.trim()} onClick={commitRename}>
            Rename
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal
        isOpen={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.name ?? ''}”?`}
        subtitle="The saved graph is removed from disk."
        icon={<TrashIcon size={18} />}
        size="sm"
      >
        <Modal.Body>
          <p>This cannot be undone. Generated meshes are not affected.</p>
        </Modal.Body>
        <Modal.Footer>
          <Button size="sm" variant="subtle" onClick={() => setDeleting(null)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={<TrashIcon size={14} />}
            onClick={() => {
              if (deleting) onDelete(deleting.id);
              setDeleting(null);
            }}
          >
            Delete
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};
