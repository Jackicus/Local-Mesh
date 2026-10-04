import React, { useRef } from 'react';
import { ImagePlusIcon, MeshIcon, PackageIcon } from '../../assets/icons';
import { dockStore } from '../../stores/dockStore';
import { useGenerationStore } from '../../stores/generationStore';
import { useModelStore } from '../../stores/modelStore';
import { useInstalledModels } from './installedModels';
import { useThreeScene } from './useThreeScene';
import { useViewerStore } from './viewerStore';
import { pickImages } from './imageInput';

/**
 * The viewport: a WebGL canvas under everything else, plus the two things that
 * belong to the model rather than the app chrome. What is on screen is named
 * in the titlebar and its history sits above the queue (see JobHeader); this
 * keeps only the invitation for when nothing is.
 */
export const Scene: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewer] = useViewerStore();
  const [, generation] = useGenerationStore();
  useThreeScene(containerRef);

  const empty = !viewer.loaded && !viewer.loading;

  // First run: nothing real is installed, so a picture would only make a row
  // that says "not installed". Ask for the model first, in the one place a new
  // user is guaranteed to be looking. The test shape does not count — it is
  // for checking the plumbing, not for a first result — and an unhydrated
  // store is not "nothing installed", it is "not known yet".
  const [models] = useModelStore();
  const installed = useInstalledModels();
  const needsModel = models.hydrated && !installed.some((m) => m.hfRepo !== '');

  return (
    <>
      <div className="gen-canvas" ref={containerRef} />

      {empty && (
        <div className="gen-empty">
          <MeshIcon size={34} strokeWidth={1.1} />
          <p className="gen-empty-title">Turn a picture into a shape</p>
          {needsModel ? (
            <>
              <p className="gen-empty-hint">Install a model first. It does the work, and you only download it once.</p>
              <button type="button" className="gen-empty-pick" onClick={() => dockStore.setActiveItem('models')}>
                <PackageIcon size={14} />
                Install a model
              </button>
            </>
          ) : (
            <>
              <p className="gen-empty-hint">Drop one anywhere in this window and it becomes a job below.</p>
              <button
                type="button"
                className="gen-empty-pick"
                onClick={async () => {
                  const paths = await pickImages();
                  if (paths.length > 0) void generation.addJobs(paths);
                }}
              >
                <ImagePlusIcon size={14} />
                Choose a picture
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
};
