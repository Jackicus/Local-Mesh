import React, { useRef } from 'react';
import { MESH_OP_DEFINITIONS } from '../../../core/types';
import { currentRevision } from '../../../core/generation';
import { jobTitle } from '../../../core/jobs';
import { ImagePlusIcon, LoaderIcon, MeshIcon, PackageIcon } from '../../assets/icons';
import { dockStore } from '../../stores/dockStore';
import { useGenerationStore } from '../../stores/generationStore';
import { useModelStore } from '../../stores/modelStore';
import { useInstalledModels } from './installedModels';
import { useThreeScene } from './useThreeScene';
import { useViewerStore } from './viewerStore';
import { pickImages } from './imageInput';
import { fileBaseName, formatCount } from './format';

/**
 * The viewport: a WebGL canvas under everything else, plus the two things that
 * belong to the model rather than the app chrome — the caption for what is on
 * screen, and the invitation when nothing is.
 *
 * The caption is where the selection reads. It names the job, not the file,
 * and says which of that job's revisions is being drawn, so the thing in the
 * viewport and the row in the queue are visibly the same thing. Clicking it
 * goes to that row, which is the same trip clicking the mesh makes.
 */
export const Scene: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewer, viewerActions] = useViewerStore();
  const [gen, generation] = useGenerationStore();
  useThreeScene(containerRef);

  const job = gen.jobs.find((j) => j.id === viewer.selectedJobId) ?? null;
  const revision = job ? currentRevision(job) : null;
  const empty = !viewer.loaded && !viewer.loading;

  // First run: nothing real is installed, so a picture would only make a row
  // that says "not installed". Ask for the model first, in the one place a new
  // user is guaranteed to be looking. The test shape does not count — it is
  // for checking the plumbing, not for a first result — and an unhydrated
  // store is not "nothing installed", it is "not known yet".
  const [models] = useModelStore();
  const installed = useInstalledModels();
  const needsModel = models.hydrated && !installed.some((m) => m.hfRepo !== '');

  const step = revision
    ? revision.op
      ? `${MESH_OP_DEFINITIONS[revision.op.op].short} · ${job!.cursor + 1} of ${job!.revisions.length}`
      : job!.revisions.length > 1
        ? `Generated · 1 of ${job!.revisions.length}`
        : 'Generated'
    : null;

  return (
    <>
      <div className="gen-canvas" ref={containerRef} />

      {viewer.loaded && (
        <button
          type="button"
          className="gen-plate"
          title={job ? 'Show this job in the queue' : viewer.loaded.path}
          onClick={() => job && viewerActions.pingSelection()}
        >
          <span className="gen-plate-name">{job ? jobTitle(job.draft) : fileBaseName(viewer.loaded.name)}</span>
          {step && <span className="gen-plate-step">{step}</span>}
          <span className="gen-plate-stats">
            {formatCount(viewer.loaded.vertices)} verts · {formatCount(viewer.loaded.faces)} faces
          </span>
        </button>
      )}

      {viewer.loading && (
        <div className="gen-scene-note">
          <LoaderIcon size={15} className="gen-spin" />
          <span>Reading {fileBaseName(viewer.loading)}</span>
        </div>
      )}

      {empty && (
        <div className="gen-empty">
          <MeshIcon size={34} strokeWidth={1.1} />
          <p className="gen-empty-title">Turn a picture into a shape</p>
          {needsModel ? (
            <>
              <p className="gen-empty-hint">
                First, install a model — the part that does the work. One download, and you only do it once.
              </p>
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
