import React from 'react';
import type { GenerationJob } from '../../../core/types';
import { getModel } from '../../../core/models';
import { modelSource } from '../../../core/jobs';
import { AlertTriangleIcon, ChevronDownIcon, CpuIcon, WorkflowIcon } from '../../assets/icons';
import { dockStore, useDockStore } from '../../stores/dockStore';
import { generationStore } from '../../stores/generationStore';
import { settingsStore } from '../../stores/settingsStore';
import { usePipelineStore } from '../../stores/pipelineStore';
import { useInstalledModels } from './installedModels';
import { RowPopover, usePopover } from './RowPopover';

export interface JobSourcePickerProps {
  job: GenerationJob;
  /** False once the job has started: what it ran is history. */
  editable: boolean;
}

/**
 * What the job runs, as the first control on the row — because it is the first
 * decision, and because everything to its right (the settings, and whether the
 * settings are even the user's to set) follows from it.
 *
 * A model and a pipeline are alternatives in one slot, not a control plus a
 * modifier: switching to a pipeline turns this into a pipeline picker outright
 * and the ⚙ beside it goes dead, because the graph owns those settings. The
 * switch only exists once the node editor is on; with it off there is no
 * second kind of thing to be, so there is nothing to explain.
 */
export const JobSourcePicker: React.FC<JobSourcePickerProps> = ({ job, editable }) => {
  const { open, setOpen, toggle, close, ref, anchor } = usePopover();
  const [dock] = useDockStore();
  const [pipelines] = usePipelineStore();
  const models = useInstalledModels();

  const source = job.draft.source;
  const isPipeline = source.kind === 'pipeline';
  const model = isPipeline ? null : getModel(source.modelId);
  const pipeline = isPipeline ? pipelines.list.find((p) => p.id === source.pipelineId) : undefined;
  const installed = !isPipeline && models.some((m) => m.id === source.modelId);

  const label = isPipeline
    ? (pipeline?.name ?? (source.pipelineId ? 'Missing pipeline' : 'Choose a pipeline'))
    : (model?.name ?? (source.modelId ? 'Missing model' : 'Choose a model'));

  const wrong = isPipeline ? !pipeline : !installed;

  const chooseModel = (modelId: string) => {
    close();
    if (!isPipeline && source.modelId === modelId) return;
    // A new model brings its own dials; carrying the last one's numbers across
    // would silently mean something else on every key they happen to share.
    void generationStore.updateJob(job.id, { source: modelSource(modelId) });
    // Picking a model once should be enough: main starts every new job on this,
    // so dropping five pictures after choosing gives five jobs on the right one.
    void settingsStore.update({ defaultModelId: modelId });
  };

  const choosePipeline = (pipelineId: string) => {
    close();
    if (isPipeline && source.pipelineId === pipelineId) return;
    void generationStore.updateJob(job.id, { source: { kind: 'pipeline', pipelineId } });
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`gen-source ${open ? 'is-open' : ''} ${wrong ? 'is-wrong' : ''}`}
        disabled={!editable}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={editable ? `Runs ${label}` : `Ran ${label}`}
        onClick={toggle}
      >
        <span className="gen-source-icon" aria-hidden="true">
          {wrong ? <AlertTriangleIcon size={12} /> : isPipeline ? <WorkflowIcon size={12} /> : <CpuIcon size={12} />}
        </span>
        <span className="gen-source-label">{label}</span>
        {editable && <ChevronDownIcon size={12} className="gen-source-caret" />}
      </button>

      <RowPopover open={open} anchor={anchor} onClose={close} label="What this job runs" width={244}>
        <span className="gen-popover-title">{isPipeline ? 'Pipeline' : 'Model'}</span>

        {isPipeline ? (
          pipelines.list.length === 0 ? (
            <p className="gen-blank">No pipelines saved yet.</p>
          ) : (
            <ul className="gen-choices">
              {pipelines.list.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`gen-choice ${p.id === source.pipelineId ? 'is-current' : ''}`}
                    onClick={() => choosePipeline(p.id)}
                  >
                    <span className="gen-choice-name">{p.name}</span>
                    <span className="gen-choice-meta">
                      {(p.modelId && getModel(p.modelId)?.name) || `${p.nodeCount} nodes`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : models.length === 0 ? (
          <>
            <p className="gen-blank">Nothing is installed yet, so there is nothing to run.</p>
            <button type="button" className="gen-link" onClick={() => dockStore.setActiveItem('models')}>
              Install a model
            </button>
          </>
        ) : (
          <ul className="gen-choices">
            {models.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className={`gen-choice ${m.id === (isPipeline ? '' : source.modelId) ? 'is-current' : ''}`}
                  onClick={() => chooseModel(m.id)}
                  title={m.description}
                >
                  <span className="gen-choice-name">{m.name}</span>
                  <span className="gen-choice-meta">{m.vramGb > 0 ? `${m.vramGb} GB` : 'no GPU'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* The editor is off by default, and so is any mention of it. */}
        {dock.advanced && (
          <div className="gen-popover-foot">
            {isPipeline ? (
              <button
                type="button"
                className="gen-link"
                onClick={() => {
                  setOpen(false);
                  const first = models[0];
                  if (first) void generationStore.updateJob(job.id, { source: modelSource(first.id) });
                }}
                disabled={models.length === 0}
              >
                Run a model instead
              </button>
            ) : (
              <button
                type="button"
                className="gen-link"
                onClick={() => {
                  const first = pipelines.selectedId ?? pipelines.list[0]?.id;
                  if (first) choosePipeline(first);
                }}
                disabled={pipelines.list.length === 0}
              >
                Run a pipeline instead
              </button>
            )}
          </div>
        )}
      </RowPopover>
    </>
  );
};
