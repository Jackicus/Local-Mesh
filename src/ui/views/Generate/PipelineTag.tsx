import React from 'react';
import type { GenerationJob } from '../../../core/types';
import { Badge, Button, Form, toast } from '../../components';
import { AlertTriangleIcon, CpuIcon, EditIcon } from '../../assets/icons';
import { getModel } from '../../../core/models';
import { dockStore } from '../../stores/dockStore';
import { generationStore } from '../../stores/generationStore';
import { useModelStore } from '../../stores/modelStore';
import { usePipelineStore } from '../../stores/pipelineStore';
import { QualityPicker } from './QualityPicker';
import { useRunTarget } from './runTarget';

/**
 * The pipeline a bar runs. The tag on the bar is the handle; the chooser opens
 * in the bar's own panel rather than over the viewport, so it can't be clipped
 * by the queue's scroll and never covers the model.
 *
 * On the composer it edits the selection outright. On a job still in the queue
 * there is no way to rewrite a spec in flight, so changing the pipeline cancels
 * that job and queues the same image again on the new one, back in the slot it
 * just left. On anything running or finished the pipeline is history: the panel
 * names it and offers it for the next run.
 */

export interface PipelineTagProps {
  /** Omitted on the composer, where the tag edits the selection for the next run. */
  job?: GenerationJob;
  open: boolean;
  onToggle: () => void;
}

export const PipelineTag: React.FC<PipelineTagProps> = ({ job, open, onToggle }) => {
  const target = useRunTarget();

  const label = job
    ? getModel(job.modelId)?.name ?? job.modelId
    : target.modelName ?? (target.pipelineId ? 'No model in graph' : 'No pipeline');

  return (
    <button
      type="button"
      className={`gen-tag ${open ? 'is-open' : ''}`}
      aria-expanded={open}
      title={job ? `${job.pipelineName} · ${label}` : 'Choose the pipeline to run'}
      onClick={onToggle}
    >
      <CpuIcon size={12} />
      <span className="gen-tag-label">{label}</span>
    </button>
  );
};

export interface PipelinePanelProps {
  job?: GenerationJob;
  /** Position among the queued jobs, so a swapped job keeps its place in line. */
  queuedIndex?: number;
  onDone: () => void;
}

export const PipelinePanel: React.FC<PipelinePanelProps> = ({ job, queuedIndex = -1, onDone }) => {
  const [pipelines, pipelineActions] = usePipelineStore();
  const [models] = useModelStore();
  const target = useRunTarget();

  const editable = job === undefined || job.status === 'queued';
  const options = pipelines.list.map((p) => ({ value: p.id, label: p.name }));
  const selectedId = job ? job.pipelineId : pipelines.selectedId ?? '';

  // Weights and dependencies install separately, so name the step that is missing.
  const install = target.modelId ? models.installs[target.modelId] : undefined;
  const blocker =
    install?.weights !== 'complete'
      ? { message: 'Weights not downloaded', action: 'Download' }
      : { message: 'Dependencies not installed', action: 'Install deps for' };

  const choose = async (pipelineId: string) => {
    if (!job) {
      pipelineActions.select(pipelineId || null);
      return;
    }
    if (!pipelineId || pipelineId === job.pipelineId) return;
    onDone();
    await generationStore.cancel(job.id);
    const ids = await generationStore.enqueue({ pipelineId, imagePaths: [job.imagePath] });
    const requeued = ids[0];
    if (!requeued) return;
    if (queuedIndex >= 0) await generationStore.reorder(requeued, queuedIndex);
    const name = pipelines.list.find((p) => p.id === pipelineId)?.name ?? 'the new pipeline';
    toast.success(`${job.imageName} now runs ${name}`);
  };

  return (
    <div className="gen-pipepanel">
      <span className="gen-popover-title">{editable ? 'Run with' : 'Ran with'}</span>

      {editable ? (
        <Form.Select
          size="sm"
          options={options}
          value={selectedId}
          placeholder={options.length ? 'Choose a pipeline' : 'No pipelines yet'}
          disabled={options.length === 0}
          onChange={(e) => void choose(e.target.value)}
        />
      ) : (
        <p className="gen-popover-value">{job?.pipelineName}</p>
      )}

      {job === undefined && (
        <>
          {/* The one dial a normal user wants, next to the model it acts on —
              rather than four sliders on the most advanced screen in the app. */}
          <div className="gen-quality-row">
            <span className="gen-popover-title">Quality</span>
            <QualityPicker />
          </div>

          <div className="gen-meta-row">
            <Badge variant={target.modelReady ? 'neutral' : 'warning'} icon={<CpuIcon size={12} />}>
              {target.modelName ?? 'No model in graph'}
            </Badge>
            {target.willSwitchModel && (
              <span className="gen-note">Replaces {target.loadedModelName} on run</span>
            )}
          </div>

          {target.modelId && !target.modelReady && (
            <div className="gen-warn">
              <AlertTriangleIcon size={14} />
              <div className="gen-warn-body">
                <p>{blocker.message}</p>
                <Button variant="secondary" size="sm" onClick={() => dockStore.setActiveItem('models')}>
                  {blocker.action} {target.modelName}
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {job && job.status === 'queued' && (
        <p className="gen-popover-note">
          Queues this image again on the new pipeline, in the same place in line.
        </p>
      )}

      <div className="ui-btn-row">
        {job && !editable && (
          <Button
            variant="secondary"
            size="sm"
            disabled={pipelines.selectedId === job.pipelineId}
            onClick={() => {
              pipelineActions.select(job.pipelineId);
              onDone();
            }}
          >
            Use next
          </Button>
        )}
        <Button
          variant="subtle"
          size="sm"
          icon={<EditIcon size={13} />}
          onClick={() => {
            // Opening the editor on purpose is opting in to it, so the nav
            // item appears rather than leaving the view unreachable again.
            dockStore.setAdvanced(true);
            dockStore.setActiveItem('pipelines');
          }}
        >
          Edit pipelines
        </Button>
      </div>
    </div>
  );
};
