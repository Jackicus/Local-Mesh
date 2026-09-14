import React, { useRef } from 'react';
import { MeshIcon, LoaderIcon } from '../../assets/icons';
import { useThreeScene } from './useThreeScene';
import { useViewerStore } from './viewerStore';
import { fileBaseName, formatCount } from './format';

/**
 * The viewport: a WebGL canvas under everything else, plus the two things
 * that belong to the model rather than the app chrome — the caption for what
 * is on screen, and the invitation when nothing is.
 */
export const Scene: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewer] = useViewerStore();
  useThreeScene(containerRef);

  const empty = !viewer.loaded && !viewer.loading;

  return (
    <>
      <div className="gen-canvas" ref={containerRef} />

      {viewer.loaded && (
        <div className="gen-plate">
          <span className="gen-plate-name">{fileBaseName(viewer.loaded.name)}</span>
          <span className="gen-plate-stats">
            {formatCount(viewer.loaded.vertices)} verts · {formatCount(viewer.loaded.faces)} faces
          </span>
        </div>
      )}

      {viewer.loading && (
        <div className="gen-scene-note">
          <LoaderIcon size={15} className="gen-spin" />
          <span>Reading {fileBaseName(viewer.loading)}</span>
        </div>
      )}

      {empty && (
        <div className="gen-empty">
          <MeshIcon size={30} strokeWidth={1.25} />
          <p className="gen-empty-title">Nothing loaded</p>
          <p className="gen-empty-hint">Drop an image or pick one to generate</p>
        </div>
      )}
    </>
  );
};
