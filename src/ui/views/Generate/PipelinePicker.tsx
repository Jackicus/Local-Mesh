import React from 'react';
import { Badge, Button, Form } from '../../components';
import { AlertTriangleIcon, CpuIcon, EditIcon } from '../../assets/icons';
import { dockStore } from '../../stores/dockStore';
import { useModelStore } from '../../stores/modelStore';
import { usePipelineStore } from '../../stores/pipelineStore';
import { DockSection } from './DockSection';
import { useRunTarget } from './runTarget';

/** Which saved graph runs, and anything standing between it and a result. */
export const PipelinePicker: React.FC = () => {
  const [pipelines, pipelineActions] = usePipelineStore();
  const [models] = useModelStore();
  const target = useRunTarget();

  // Weights and dependencies install separately, so name the step that is missing.
  const install = target.modelId ? models.installs[target.modelId] : undefined;
  const blocker =
    install?.weights !== 'complete'
      ? { message: 'Weights not downloaded', action: 'Download' }
      : { message: 'Dependencies not installed', action: 'Install deps for' };

  const options = pipelines.list.map((p) => ({ value: p.id, label: p.name }));

  return (
    <DockSection
      title="Pipeline"
      action={
        <Button
          variant="subtle"
          size="sm"
          className="btn-icon-only"
          icon={<EditIcon size={14} />}
          aria-label="Edit pipelines"
          onClick={() => dockStore.setActiveItem('pipelines')}
        />
      }
    >
      <Form.Select
        size="sm"
        options={options}
        value={pipelines.selectedId ?? ''}
        placeholder={options.length ? 'Choose a pipeline' : 'No pipelines yet'}
        disabled={options.length === 0}
        onChange={(e) => pipelineActions.select(e.target.value || null)}
      />

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
    </DockSection>
  );
};
