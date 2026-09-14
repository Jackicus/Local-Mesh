import React from 'react';
import type { NodeType, Pipeline } from '../../../core/pipeline';
import { NODE_DEFINITIONS } from '../../../core/pipeline';
import { Button, contextMenuStore } from '../../components';
import { CheckIcon, FitViewIcon, LoaderIcon, PlusIcon } from '../../assets/icons';
import type { SaveState } from './usePipelineDoc';

export interface EditorToolbarProps {
  pipeline: Pipeline;
  saveState: SaveState;
  onAddNode: (type: NodeType) => void;
  onFit: () => void;
}

const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'Saved',
  dirty: 'Saving…',
  saving: 'Saving…',
  local: 'Not saved (browser)',
};

/** Anchor the shared context menu under a button instead of the pointer. */
function menuUnder(el: HTMLElement, items: Parameters<typeof contextMenuStore.open>[1]) {
  const rect = el.getBoundingClientRect();
  contextMenuStore.open(
    {
      clientX: rect.left,
      clientY: rect.bottom + 6,
      preventDefault() {},
      stopPropagation() {},
    } as unknown as React.MouseEvent,
    items
  );
}

/** The canvas's own controls, floating top-left over it. */
export const EditorToolbar: React.FC<EditorToolbarProps> = ({ pipeline, saveState, onAddNode, onFit }) => {
  const present = new Set(pipeline.nodes.map((n) => n.type));

  const openAddMenu = (e: React.MouseEvent<HTMLButtonElement>) =>
    menuUnder(
      e.currentTarget,
      Object.values(NODE_DEFINITIONS).map((def) => ({
        id: def.type,
        label: def.label,
        disabled: def.singleton && present.has(def.type),
        onClick: () => onAddNode(def.type),
      }))
    );

  return (
    <header className="pipe-toolbar">
      <Button size="sm" variant="secondary" icon={<PlusIcon size={14} />} onClick={openAddMenu}>
        Add node
      </Button>
      <Button size="sm" variant="subtle" icon={<FitViewIcon size={14} />} onClick={onFit} title="Zoom to fit (all nodes)">
        Fit
      </Button>
      <span className="pipe-toolbar-sep" aria-hidden="true" />
      <span className={`pipe-save-state ${saveState}`} role="status">
        {saveState === 'saving' || saveState === 'dirty' ? <LoaderIcon size={13} className="pipe-spin" /> : null}
        {saveState === 'saved' && <CheckIcon size={13} />}
        {SAVE_LABEL[saveState]}
      </span>
    </header>
  );
};
