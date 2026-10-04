import React from 'react';
import { useViewerStore } from './viewerStore';
import { formatCount } from './format';

/**
 * How big the mesh on screen is, as bare text at the top of the bottom-left
 * column, over the history and the queue. It reads what
 * the viewport actually drew, so it is right for a saved file opened from the
 * outputs list as much as for a job's current step.
 */
export const MeshStats: React.FC = () => {
  const [viewer] = useViewerStore();
  if (!viewer.loaded) return null;
  return (
    <dl className="gen-meshstats" aria-label="Mesh size">
      <div>
        <dt>Verts</dt>
        <dd>{formatCount(viewer.loaded.vertices)}</dd>
      </div>
      <div>
        <dt>Faces</dt>
        <dd>{formatCount(viewer.loaded.faces)}</dd>
      </div>
    </dl>
  );
};
