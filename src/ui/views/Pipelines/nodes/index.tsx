import React from 'react';
import type {
  BackgroundRemovalData,
  ImageInputData,
  MeshExportData,
  MeshGeneratorData,
  PipelineNode,
  PostProcessData,
} from '../../../../core/pipeline';
import { ImageInputNode } from './ImageInputNode';
import { BackgroundRemovalNode } from './BackgroundRemovalNode';
import { MeshGeneratorNode } from './MeshGeneratorNode';
import { PostProcessNode } from './PostProcessNode';
import { MeshExportNode } from './MeshExportNode';

interface NodeBodyDispatchProps {
  node: PipelineNode;
  onChange: (patch: Record<string, unknown>) => void;
}

/** Picks the body editor for a node type. `data` is trusted to match the type. */
export const NodeBody: React.FC<NodeBodyDispatchProps> = ({ node, onChange }) => {
  switch (node.type) {
    case 'image-input':
      return <ImageInputNode data={node.data as ImageInputData} onChange={onChange} />;
    case 'background-removal':
      return <BackgroundRemovalNode data={node.data as BackgroundRemovalData} onChange={onChange} />;
    case 'mesh-generator':
      return <MeshGeneratorNode data={node.data as MeshGeneratorData} onChange={onChange} />;
    case 'post-process':
      return <PostProcessNode data={node.data as PostProcessData} onChange={onChange} />;
    case 'mesh-export':
      return <MeshExportNode data={node.data as MeshExportData} onChange={onChange} />;
    default:
      return null;
  }
};
