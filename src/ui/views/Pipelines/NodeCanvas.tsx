import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Pipeline, PortType } from '../../../core/pipeline';
import { NODE_DEFINITIONS, newId } from '../../../core/pipeline';
import { clamp, portPosition, type Point, type Viewport } from './canvasGeometry';
import { gridStyle, type CanvasViewport } from './useCanvasViewport';
import { NodeCard } from './NodeCard';
import { EdgeLayer, type PendingWire } from './EdgeLayer';

export type Selection = { kind: 'node' | 'edge'; id: string } | null;

export interface NodeCanvasProps {
  pipeline: Pipeline;
  onChange: (fn: (p: Pipeline) => Pipeline) => void;
  vp: CanvasViewport;
}

interface PendingState {
  nodeId: string;
  portId: string;
  type: PortType;
  from: Point;
  cursor: Point;
}

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

/**
 * The pan/zoom surface. Nodes and the edge SVG live in one transformed
 * `.pipe-world`; live drags update local state (rAF-batched by the cards)
 * and only commit to the pipeline on release so the debounced save fires once.
 */
export const NodeCanvas: React.FC<NodeCanvasProps> = ({ pipeline, onChange, vp }) => {
  const [selection, setSelection] = useState<Selection>(null);
  const [drag, setDrag] = useState<{ id: string; pos: Point } | null>(null);
  const [pending, setPending] = useState<PendingState | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const pendingRef = useRef<PendingState | null>(null);
  const pan = useRef<{ startX: number; startY: number; origin: Viewport } | null>(null);
  const pipelineRef = useRef(pipeline);
  pipelineRef.current = pipeline;

  // Fit once per loaded pipeline, after its nodes have rendered.
  useLayoutEffect(() => {
    vp.fitToNodes(pipelineRef.current);
    setSelection(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipeline.id]);

  // Native wheel listener: React's is passive, so it can't stop the page scroll.
  useEffect(() => {
    const el = vp.surfaceRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      vp.zoomAt(e.clientX, e.clientY, clamp(Math.exp(-e.deltaY * 0.0015), 0.8, 1.25));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [vp]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === ' ' && !isEditable(e.target)) setSpaceHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // ---- panning -------------------------------------------------------------
  const onSurfacePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const empty = e.target === e.currentTarget;
    if (!(e.button === 1 || spaceHeld || (e.button === 0 && empty))) return;
    if (empty && e.button === 0) setSelection(null);
    pan.current = { startX: e.clientX, startY: e.clientY, origin: vp.viewportRef.current };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.classList.add('panning');
  };
  const onSurfacePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = pan.current;
    if (!p) return;
    vp.applyLive({ ...p.origin, x: p.origin.x + e.clientX - p.startX, y: p.origin.y + e.clientY - p.startY });
  };
  const onSurfacePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pan.current) return;
    pan.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    e.currentTarget.classList.remove('panning');
    vp.setViewport(vp.viewportRef.current);
  };

  // ---- connections ---------------------------------------------------------
  const onConnectStart = useCallback(
    (nodeId: string, portId: string, type: PortType, e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const node = pipelineRef.current.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const index = NODE_DEFINITIONS[node.type].outputs.findIndex((p) => p.id === portId);
      const from = portPosition(node, 'out', index);
      const start: PendingState = { nodeId, portId, type, from, cursor: vp.toCanvas(e.clientX, e.clientY) };
      pendingRef.current = start;
      setPending(start);

      let frame: number | null = null;
      const move = (ev: PointerEvent) => {
        if (frame !== null) return;
        frame = requestAnimationFrame(() => {
          frame = null;
          if (!pendingRef.current) return;
          const next = { ...pendingRef.current, cursor: vp.toCanvas(ev.clientX, ev.clientY) };
          pendingRef.current = next;
          setPending(next);
        });
      };
      const up = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (frame !== null) cancelAnimationFrame(frame);
        const p = pendingRef.current;
        pendingRef.current = null;
        setPending(null);
        const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-port-dir="in"]');
        if (!p || !target) return;
        const toNode = target.dataset['nodeId'];
        const toPort = target.dataset['portId'];
        if (!toNode || !toPort || toNode === p.nodeId || target.dataset['portType'] !== p.type) return;
        onChange((cur) => ({
          ...cur,
          edges: [
            // An input accepts one wire: drop whatever was there.
            ...cur.edges.filter((edge) => !(edge.to.node === toNode && edge.to.port === toPort)),
            { id: newId('edge'), from: { node: p.nodeId, port: p.portId }, to: { node: toNode, port: toPort } },
          ],
        }));
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [vp, onChange]
  );

  // ---- node edits ----------------------------------------------------------
  const onDragEnd = useCallback(
    (id: string, pos: Point) => {
      setDrag(null);
      onChange((cur) => ({ ...cur, nodes: cur.nodes.map((n) => (n.id === id ? { ...n, position: pos } : n)) }));
    },
    [onChange]
  );
  const onDataChange = useCallback(
    (id: string, patch: Record<string, unknown>) =>
      onChange((cur) => ({ ...cur, nodes: cur.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)) })),
    [onChange]
  );
  const deleteEdge = useCallback(
    (id: string) => {
      setSelection((s) => (s?.kind === 'edge' && s.id === id ? null : s));
      onChange((cur) => ({ ...cur, edges: cur.edges.filter((e) => e.id !== id) }));
    },
    [onChange]
  );
  const deleteNode = (id: string) => {
    setSelection(null);
    onChange((cur) => ({
      ...cur,
      nodes: cur.nodes.filter((n) => n.id !== id),
      edges: cur.edges.filter((e) => e.from.node !== id && e.to.node !== id),
    }));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isEditable(e.target)) return;
    if (e.key === 'Escape') {
      setSelection(null);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
      e.preventDefault();
      if (selection.kind === 'node') deleteNode(selection.id);
      else deleteEdge(selection.id);
    }
  };

  const liveNodes = drag ? pipeline.nodes.map((n) => (n.id === drag.id ? { ...n, position: drag.pos } : n)) : pipeline.nodes;
  const wire: PendingWire | null = pending ? { from: pending.from, to: pending.cursor, type: pending.type } : null;
  const v = vp.viewport;
  const getZoom = useCallback(() => vp.viewportRef.current.zoom, [vp]);

  return (
    <div
      ref={vp.surfaceRef}
      className={`pipe-canvas ${spaceHeld ? 'space' : ''} ${pending ? `connecting-${pending.type}` : ''}`}
      style={gridStyle(v)}
      tabIndex={0}
      role="application"
      aria-label="Pipeline canvas"
      onPointerDown={onSurfacePointerDown}
      onPointerMove={onSurfacePointerMove}
      onPointerUp={onSurfacePointerUp}
      onPointerCancel={onSurfacePointerUp}
      onKeyDown={onKeyDown}
    >
      <div ref={vp.worldRef} className="pipe-world" style={{ transform: `translate(${v.x}px, ${v.y}px) scale(${v.zoom})` }}>
        <EdgeLayer
          nodes={liveNodes}
          edges={pipeline.edges}
          selectedEdgeId={selection?.kind === 'edge' ? selection.id : null}
          pending={wire}
          onSelectEdge={(id) => setSelection({ kind: 'edge', id })}
          onDeleteEdge={deleteEdge}
        />
        {liveNodes.map((node) => (
          <NodeCard
            key={node.id}
            node={node}
            selected={selection?.kind === 'node' && selection.id === node.id}
            getZoom={getZoom}
            onSelect={(id) => setSelection((s) => (s?.kind === 'node' && s.id === id ? s : { kind: 'node', id }))}
            onDragMove={(id, pos) => setDrag({ id, pos })}
            onDragEnd={onDragEnd}
            onDataChange={onDataChange}
            onConnectStart={onConnectStart}
          />
        ))}
      </div>
      {pipeline.nodes.length === 0 && <p className="pipe-empty">Empty pipeline. Use “Add node” to start.</p>}
    </div>
  );
};
