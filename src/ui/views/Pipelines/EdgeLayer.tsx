import React from 'react';
import type { PipelineEdge, PipelineNode, PortType } from '../../../core/pipeline';
import { NODE_DEFINITIONS } from '../../../core/pipeline';
import { bezierMidpoint, bezierPath, portColor, portPosition, type Point } from './canvasGeometry';

export interface PendingWire {
  from: Point;
  to: Point;
  type: PortType;
}

export interface EdgeLayerProps {
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  selectedEdgeId: string | null;
  pending: PendingWire | null;
  onSelectEdge: (id: string) => void;
  onDeleteEdge: (id: string) => void;
}

interface ResolvedEdge {
  edge: PipelineEdge;
  a: Point;
  b: Point;
  type: PortType;
}

function resolve(nodes: PipelineNode[], edge: PipelineEdge): ResolvedEdge | null {
  const from = nodes.find((n) => n.id === edge.from.node);
  const to = nodes.find((n) => n.id === edge.to.node);
  if (!from || !to) return null;
  const outIndex = NODE_DEFINITIONS[from.type].outputs.findIndex((p) => p.id === edge.from.port);
  const inIndex = NODE_DEFINITIONS[to.type].inputs.findIndex((p) => p.id === edge.to.port);
  if (outIndex < 0 || inIndex < 0) return null;
  const type = NODE_DEFINITIONS[from.type].outputs[outIndex]!.type;
  return { edge, a: portPosition(from, 'out', outIndex), b: portPosition(to, 'in', inIndex), type };
}

/**
 * SVG wires. Lives inside the transformed world so it shares the nodes'
 * coordinate space; the svg itself is 1x1 with visible overflow so it never
 * intercepts pointer events except on the strokes.
 */
export const EdgeLayer: React.FC<EdgeLayerProps> = ({ nodes, edges, selectedEdgeId, pending, onSelectEdge, onDeleteEdge }) => {
  const resolved = edges.map((e) => resolve(nodes, e)).filter((r): r is ResolvedEdge => r !== null);

  return (
    <svg className="pipe-edges" width={1} height={1} aria-hidden="true">
      {resolved.map(({ edge, a, b, type }) => {
        const d = bezierPath(a, b);
        const mid = bezierMidpoint(a, b);
        const selected = edge.id === selectedEdgeId;
        return (
          <g key={edge.id} className={`pipe-edge ${selected ? 'selected' : ''}`} style={{ color: portColor(type) }}>
            <path
              className="pipe-edge-hit"
              d={d}
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelectEdge(edge.id);
              }}
            />
            <path className="pipe-edge-line" d={d} />
            <g
              className="pipe-edge-x"
              transform={`translate(${mid.x} ${mid.y})`}
              onPointerDown={(e) => {
                e.stopPropagation();
                onDeleteEdge(edge.id);
              }}
            >
              <title>Remove connection</title>
              <circle r={8} />
              <path d="M -3 -3 L 3 3 M 3 -3 L -3 3" />
            </g>
          </g>
        );
      })}
      {pending && (
        <path className="pipe-edge-pending" d={bezierPath(pending.from, pending.to)} style={{ stroke: portColor(pending.type) }} />
      )}
    </svg>
  );
};
