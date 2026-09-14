import React from 'react';
import { Button } from '../../components';
import { SparklesIcon } from '../../assets/icons';
import { dockStore } from '../../stores/dockStore';
import { useGenerationStore } from '../../stores/generationStore';
import { useViewerStore } from './viewerStore';
import { useRunTarget } from './runTarget';

/** The commit point: stage images, pick a pipeline, run. */
export const GenerateButton: React.FC = () => {
  const [viewer, viewerActions] = useViewerStore();
  const [, generation] = useGenerationStore();
  const target = useRunTarget();

  const count = viewer.images.length;
  const ready = Boolean(target.pipelineId) && target.modelReady && target.envReady;
  const hasInput = count > 0 || Boolean(target.fixedImagePath);

  const run = async () => {
    if (!target.pipelineId || !hasInput) return;
    const ids = await generation.enqueue({ pipelineId: target.pipelineId, imagePaths: viewer.images });
    if (ids.length > 0) viewerActions.clearImages();
  };

  return (
    <div className="gen-run">
      <Button
        variant="primary"
        size="md"
        fullWidth
        disabled={!ready || !hasInput}
        icon={<SparklesIcon size={15} />}
        onClick={run}
      >
        {count > 1 ? `Generate ${count} meshes` : 'Generate'}
      </Button>

      {!target.envReady && (
        <p className="gen-run-note">
          The python environment isn&apos;t set up yet.{' '}
          <button type="button" className="gen-link" onClick={() => dockStore.setActiveItem('models')}>
            Set it up in Models
          </button>
        </p>
      )}
      {target.envReady && ready && count === 0 && !target.fixedImagePath && (
        <p className="gen-run-note">Add an image to start.</p>
      )}
      {target.envReady && ready && count === 0 && target.fixedImagePath && (
        <p className="gen-run-note">Runs the pipeline&apos;s fixed image.</p>
      )}
    </div>
  );
};
