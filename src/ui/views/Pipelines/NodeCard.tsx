import React, { useRef } from 'react';
import type { PipelineNode, PortType } from '../../../core/pipeline';
import { NODE_DEFINITIONS } from '../../../core/pipeline';
import { NODE_W, PORT_ROW_H, nodeHue, portColor, type Point } from './canvasGeometry';
import { NodeBody } from './nodes';

const DRAG_THRESHOLD = 3;

export interface NodeCardProps {
  node: PipelineNode;
  selected: boolean;
  getZoom: () => number;
  onSelect: (id: string) => void;
  onDragMove: (id: string, pos: Point) => void;
  onDragEnd: (id: string, pos: Point) => void;
  onDataChange: (id: string, patch: Record<string, unknown>) => void;
  onConnectStart: (nodeId: string, portId: string, type: PortType, e: React.PointerEvent) => void;
}

/**
 * One node on the canvas: header (drag handle), typed ports on the side
 * edges, and the per-type body editor. Position comes from props so the
 * canvas can feed live drag positions to the edges as well.
 */
export const NodeCard: React.FC<NodeCardProps> = ({
  node,
  selected,
  getZoom,
  onSelect,
  onDragMove,
  onDragEnd,
  onDataChange,
  onConnectStart,
}) => {
  const def = NODE_DEFINITIONS[node.type];
  const drag = useRef<{ startX: number; startY: number; origin: Point; moving: boolean } | null>(null);
  const frame = useRef<number | null>(null);

  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    drag.current = { startX: e.clientX, startY: e.clientY, origin: node.position, moving: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const dragPosition = (e: React.PointerEvent): Point | null => {
    const d = drag.current;
    if (!d) return null;
    const zoom = getZoom();
    return { x: Math.round(d.origin.x + (e.clientX - d.startX) / zoom), y: Math.round(d.origin.y + (e.clientY - d.startY) / zoom) };
  };

  const onHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moving) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return;
      d.moving = true;
    }
    const pos = dragPosition(e);
    if (!pos || frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      onDragMove(node.id, pos);
    });
  };

  const onHeaderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d?.moving) return;
    const zoom = getZoom();
    onDragEnd(node.id, {
      x: Math.round(d.origin.x + (e.clientX - d.startX) / zoom),
      y: Math.round(d.origin.y + (e.clientY - d.startY) / zoom),
    });
  };

  const hue = nodeHue(node.type);
  const portRows = Math.max(def.inputs.length, def.outputs.length);

  return (
    <div
      className={`pipe-node ${selected ? 'selected' : ''}`}
      data-node-id={node.id}
      style={{ left: node.position.x, top: node.position.y, width: NODE_W }}
      tabIndex={0}
      role="group"
      aria-label={`${def.label} node`}
      onPointerDown={() => onSelect(node.id)}
      onFocus={() => onSelect(node.id)}
    >
      <div
        className="pipe-node-header"
        title={def.description}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
      >
        <span className="pipe-node-dot" style={{ background: portColor(hue) }} aria-hidden="true" />
        <span className="pipe-node-title">{def.label}</span>
      </div>

      {portRows > 0 && (
        <div className="pipe-ports" style={{ height: PORT_ROW_H * portRows }}>
          {def.inputs.map((p, i) => (
            <div key={`in-${p.id}`} className="pipe-port-item in" style={{ top: PORT_ROW_H * i }}>
              <span
                className="pipe-port in"
                data-port-dir="in"
                data-port-type={p.type}
                data-node-id={node.id}
                data-port-id={p.id}
                style={{ borderColor: portColor(p.type) }}
                aria-label={`${p.label} input`}
              />
              <span className="pipe-port-label">{p.label}</span>
            </div>
          ))}
          {def.outputs.map((p, i) => (
            <div key={`out-${p.id}`} className="pipe-port-item out" style={{ top: PORT_ROW_H * i }}>
              <span
                className="pipe-port out"
                data-port-dir="out"
                data-port-type={p.type}
                data-node-id={node.id}
                data-port-id={p.id}
                style={{ borderColor: portColor(p.type) }}
                aria-label={`${p.label} output, drag to connect`}
                onPointerDown={(e) => onConnectStart(node.id, p.id, p.type, e)}
              />
              <span className="pipe-port-label">{p.label}</span>
            </div>
          ))}
        </div>
      )}

      <div className="pipe-node-body">
        <NodeBody node={node} onChange={(patch) => onDataChange(node.id, patch)} />
      </div>
    </div>
  );
};
