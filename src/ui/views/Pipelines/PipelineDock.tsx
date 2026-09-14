import React from 'react';
import type { Pipeline } from '../../../core/pipeline';
import { Button, Form, Tooltip } from '../../components';
import { PanelRightCloseIcon, PlusIcon } from '../../assets/icons';
import { DockSection } from './DockSection';
import { PipelineList, type PipelineListProps } from './PipelineList';

export interface PipelineDockProps extends PipelineListProps {
  /** The pipeline open in the editor, or null when nothing is loaded. */
  pipeline: Pipeline | null;
  onNew: () => void;
  onClose: () => void;
  onNameChange: (name: string) => void;
  onDescriptionChange: (description: string) => void;
}

/**
 * The right dock: what exists (the saved pipelines) above what is open (the
 * one being edited). Both title fields write straight through `usePipelineDoc`,
 * so typing here is the same debounced save the canvas uses.
 */
export const PipelineDock: React.FC<PipelineDockProps> = ({
  pipeline,
  onNew,
  onClose,
  onNameChange,
  onDescriptionChange,
  ...listProps
}) => {
  return (
    <aside className="pipe-dock" aria-label="Pipelines">
      <header className="pipe-dock-head">
        <span className="pipe-dock-title">Pipelines</span>
        <Tooltip content="Hide panel" position="left">
          <button type="button" className="pipe-tool" aria-label="Hide panel" onClick={onClose}>
            <PanelRightCloseIcon size={16} />
          </button>
        </Tooltip>
      </header>

      <div className="pipe-dock-body">
        <DockSection
          title="Pipelines"
          meta={listProps.list.length}
          action={
            <Button size="sm" variant="subtle" icon={<PlusIcon size={14} />} onClick={onNew} title="New pipeline">
              New
            </Button>
          }
        >
          <PipelineList {...listProps} />
        </DockSection>

        {pipeline && (
          <DockSection title="Selected">
            <label className="pipe-field">
              <span className="pipe-field-label">Name</span>
              <Form.Input
                size="sm"
                value={pipeline.name}
                spellCheck={false}
                placeholder="Untitled pipeline"
                onChange={(e) => onNameChange(e.target.value)}
              />
            </label>
            <label className="pipe-field">
              <span className="pipe-field-label">Description</span>
              <Form.Input
                size="sm"
                value={pipeline.description}
                placeholder="What this pipeline is for"
                onChange={(e) => onDescriptionChange(e.target.value)}
              />
            </label>
          </DockSection>
        )}
      </div>
    </aside>
  );
};
