import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { NodeType } from '../../../core/pipeline';
import { createNode, validatePipeline } from '../../../core/pipeline';
import { Button, Tooltip, toast } from '../../components';
import { PanelRightIcon, PlusIcon, WorkflowIcon } from '../../assets/icons';
import { usePipelineStore } from '../../stores/pipelineStore';
import { DOCK_RESERVE, NODE_W } from './canvasGeometry';
import { useCanvasViewport } from './useCanvasViewport';
import { usePipelineDoc } from './usePipelineDoc';
import { PipelineDock } from './PipelineDock';
import { EditorToolbar } from './EditorToolbar';
import { ValidationBar } from './ValidationBar';
import { NodeCanvas } from './NodeCanvas';

const hasApi = () => typeof window !== 'undefined' && Boolean(window.electronAPI);

const DOCK_KEY = 'local-mesh.pipelines.dock';

function readDockPref(): boolean {
  try {
    return localStorage.getItem(DOCK_KEY) !== '0';
  } catch {
    return true;
  }
}

/**
 * Full-bleed: the node canvas is the screen, with the editor's own controls
 * floating over it and the saved pipelines in a right dock. The store owns the
 * summary list; `usePipelineDoc` owns the one full graph being edited and its
 * debounced save.
 */
export const PipelinesView: React.FC = () => {
  const [state, pipelines] = usePipelineStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dockOpen, setDockOpen] = useState(readDockPref);
  // Zoom-to-fit must aim at the part of the canvas the dock doesn't cover.
  const vp = useCanvasViewport(dockOpen ? DOCK_RESERVE : 0);
  // Without the desktop API there is nothing to read, but the editor still
  // runs on an in-memory default; any non-null id gets the hook there.
  const docId = editingId ?? (hasApi() ? null : 'local');
  const { pipeline, saveState, update, flush, discard } = usePipelineDoc(docId);

  const toggleDock = (open: boolean) => {
    setDockOpen(open);
    try {
      localStorage.setItem(DOCK_KEY, open ? '1' : '0');
    } catch {
      /* private mode: the dock just doesn't remember */
    }
  };

  // Follow the list: after hydration, a delete, or first launch (the store
  // seeds a Default), edit the first pipeline that exists.
  useEffect(() => {
    if (editingId && state.list.some((p) => p.id === editingId)) return;
    setEditingId(state.list[0]?.id ?? null);
  }, [state.list, editingId]);

  const issues = useMemo(() => (pipeline ? validatePipeline(pipeline) : []), [pipeline]);

  const addNode = useCallback(
    (type: NodeType) => {
      const c = vp.visibleCenter();
      update((p) => ({
        ...p,
        nodes: [...p.nodes, createNode(type, { x: Math.round(c.x - NODE_W / 2), y: Math.round(c.y - 70) })],
      }));
    },
    [vp, update]
  );

  const createPipeline = async () => {
    await flush();
    const created = await pipelines.create('New pipeline');
    if (created) setEditingId(created.id);
    else toast.info('Pipelines are saved by the desktop app');
  };

  const rename = async (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (id === editingId) {
      update((p) => ({ ...p, name: trimmed }));
      return;
    }
    const doc = await pipelines.read(id);
    if (doc) await pipelines.save({ ...doc, name: trimmed });
  };

  const duplicate = async (id: string) => {
    await flush();
    const copy = await pipelines.duplicate(id);
    if (copy) {
      setEditingId(copy.id);
      toast.success(`Duplicated as “${copy.name}”`);
    }
  };

  const useInGenerate = (id: string) => {
    pipelines.select(id);
    const name = state.list.find((p) => p.id === id)?.name ?? 'Pipeline';
    toast.success(`Generate will run “${name}”`);
  };

  const remove = async (id: string) => {
    if (id === editingId) discard();
    await pipelines.remove(id);
  };

  return (
    <div className={`pipe-view ${dockOpen ? 'is-docked' : ''}`}>
      {pipeline ? (
        <>
          <NodeCanvas pipeline={pipeline} onChange={update} vp={vp} />
          <EditorToolbar
            pipeline={pipeline}
            saveState={saveState}
            onAddNode={addNode}
            onFit={() => vp.fitToNodes(pipeline)}
          />
          <ValidationBar issues={issues} />
        </>
      ) : (
        <div className="pipe-blank">
          <WorkflowIcon size={28} />
          <h2>No pipeline open</h2>
          <p>A pipeline is the recipe Generate runs: an image in, a mesh out, with the model and its settings in between.</p>
          <Button variant="primary" icon={<PlusIcon size={14} />} onClick={() => void createPipeline()}>
            New pipeline
          </Button>
        </div>
      )}

      {dockOpen ? (
        <PipelineDock
          pipeline={pipeline}
          list={state.list}
          editingId={editingId}
          selectedId={state.selectedId}
          onClose={() => toggleDock(false)}
          onOpen={setEditingId}
          onNew={() => void createPipeline()}
          onNameChange={(name) => update((p) => ({ ...p, name }))}
          onDescriptionChange={(description) => update((p) => ({ ...p, description }))}
          onRename={(id, name) => void rename(id, name)}
          onDuplicate={(id) => void duplicate(id)}
          onUseInGenerate={useInGenerate}
          onDelete={(id) => void remove(id)}
        />
      ) : (
        <div className="pipe-dock-open-wrap">
          <Tooltip content="Show panel" position="left">
            <button type="button" className="pipe-tool pipe-dock-open" aria-label="Show panel" onClick={() => toggleDock(true)}>
              <PanelRightIcon size={16} />
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
};
