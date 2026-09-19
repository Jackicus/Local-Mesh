import React from 'react';
import { Button } from '../../components';
import { ChevronDownIcon, ImagePlusIcon, SparklesIcon } from '../../assets/icons';
import { useGenerationStore } from '../../stores/generationStore';
import { ImageDrop, pickImages } from './ImageDrop';
import type { BarPanel } from './QueueBar';
import { PipelinePanel, PipelineTag } from './PipelineTag';
import { Thumbnail } from './Thumbnail';
import { fileBaseName } from './format';
import { useRunTarget } from './runTarget';
import { useViewerStore } from './viewerStore';

export interface ComposerProps {
  panel: BarPanel;
  onPanel: (panel: Exclude<BarPanel, null>) => void;
  onClosePanel: () => void;
}

/**
 * The bar for the job you are about to run: the same anatomy as a queue bar,
 * but the stop button is a Generate button and the detail line explains
 * whatever is standing between the pipeline and a result.
 */
export const Composer: React.FC<ComposerProps> = ({ panel, onPanel, onClosePanel }) => {
  const [viewer, viewerActions] = useViewerStore();
  const [gen, generation] = useGenerationStore();
  const target = useRunTarget();

  const count = viewer.images.length;
  const ready = Boolean(target.pipelineId) && target.modelReady && target.envReady;
  const hasInput = count > 0 || Boolean(target.fixedImagePath);

  const run = async () => {
    if (!target.pipelineId || !hasInput) return;
    const ids = await generation.enqueue({ pipelineId: target.pipelineId, imagePaths: viewer.images });
    if (ids.length > 0) viewerActions.clearImages();
  };

  const title =
    count > 0
      ? count === 1
        ? fileBaseName(viewer.images[0]!)
        : `${count} images staged`
      : target.fixedImagePath
        ? fileBaseName(target.fixedImagePath)
        : 'New job';

  // The bar is one line wide and clips what will not fit, so it never carries
  // a sentence with a link in it: when setup is outstanding the card in the
  // middle of the viewport is saying so, at full width, with the button.
  const detail = (): React.ReactNode => {
    if (gen.workerError) return <span className="is-error">{gen.workerError}</span>;
    if (!target.pipelineId) return 'Choose a pipeline to start';
    if (!target.envReady || !target.modelReady) return 'Finish setup first';
    if (count === 0 && target.fixedImagePath) return "Runs the pipeline's own image";
    if (count === 0) {
      return (
        <>
          Drop an image, or{' '}
          <button
            type="button"
            className="gen-link"
            onClick={async () => viewerActions.addImages(await pickImages())}
          >
            choose one
          </button>
        </>
      );
    }
    return `Ready · ${count === 1 ? 'one mesh' : `${count} meshes`}`;
  };

  return (
    <div className={`gen-composer ${panel ? 'is-expanded' : ''}`}>
      <div className="gen-qbar-row">
        <span className="gen-qbar-glyph" aria-hidden="true">
          <ImagePlusIcon size={13} />
        </span>

        {count > 0 ? (
          <Thumbnail path={viewer.images[0]!} size="xs" />
        ) : (
          <span className="gen-thumb gen-thumb-xs is-empty" aria-hidden="true" />
        )}

        <div className="gen-qbar-body">
          <span className="gen-qbar-name">{title}</span>
          <span className="gen-qbar-detail">{detail()}</span>
        </div>

        {/* Empty, but it holds the column so the composer lines up with the bars. */}
        <span className="gen-qbar-clock" />

        <PipelineTag open={panel === 'pipeline'} onToggle={() => onPanel('pipeline')} />

        <button
          type="button"
          className={`gen-qbar-btn ${panel === 'detail' ? 'is-active' : ''}`}
          aria-expanded={panel === 'detail'}
          aria-label={panel === 'detail' ? 'Hide the image input' : 'Show the image input'}
          onClick={() => onPanel('detail')}
        >
          <ChevronDownIcon size={14} className={`gen-chevron ${panel === 'detail' ? 'is-open' : ''}`} />
        </button>

        <Button
          variant="primary"
          size="sm"
          className="gen-composer-run"
          disabled={!ready || !hasInput}
          icon={<SparklesIcon size={14} />}
          onClick={() => void run()}
        >
          {count > 1 ? `Generate ${count}` : 'Generate'}
        </Button>
      </div>

      {panel === 'pipeline' && (
        <div className="gen-qbar-panel">
          <PipelinePanel onDone={onClosePanel} />
        </div>
      )}

      {panel === 'detail' && (
        <div className="gen-qbar-panel">
          <ImageDrop />
        </div>
      )}
    </div>
  );
};
