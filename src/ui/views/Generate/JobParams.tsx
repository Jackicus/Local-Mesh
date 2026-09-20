import React, { useState } from 'react';
import type { ExportFormat, GenerationJob } from '../../../core/types';
import { getModel } from '../../../core/models';
import { jobTitle } from '../../../core/jobs';
import { Form } from '../../components';
import { ChevronDownIcon, SlidersIcon } from '../../assets/icons';
import { dockStore } from '../../stores/dockStore';
import { generationStore } from '../../stores/generationStore';
import { SettingField } from '../Pipelines/nodes/SettingField';
import { QualityPicker } from './QualityPicker';
import { RowPopover, usePopover } from './RowPopover';

const FORMATS: Array<{ value: ExportFormat; label: string }> = [
  { value: 'glb', label: 'GLB' },
  { value: 'obj', label: 'OBJ' },
  { value: 'stl', label: 'STL' },
  { value: 'ply', label: 'PLY' },
];

export interface JobParamsProps {
  job: GenerationJob;
  /** False once the job has started; the form then shows what it ran, greyed. */
  editable: boolean;
}

/**
 * The chosen model's own dials, on the row that runs it.
 *
 * The fields are not written here: they are generated from the registry by the
 * same `SettingField` the node editor builds its generator node from, so a
 * model that gains a setting gains it in both places at once and neither can
 * drift into describing the other's idea of a slider.
 *
 * A pipeline-sourced job has no form to show — the graph owns those settings —
 * so this says so and offers the way to the graph instead of pretending to
 * have knobs it cannot honour.
 */
export const JobParams: React.FC<JobParamsProps> = ({ job, editable }) => {
  const { open, toggle, close, ref, anchor } = usePopover();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const source = job.draft.source;
  const isPipeline = source.kind === 'pipeline';
  const model = isPipeline ? null : getModel(source.modelId);

  const patchSettings = (settings: Record<string, number | string | boolean>) => {
    if (isPipeline) return;
    void generationStore.updateJob(job.id, { source: { ...source, settings } });
  };

  const plain = model?.settings.filter((s) => !s.advanced) ?? [];
  const advanced = model?.settings.filter((s) => s.advanced) ?? [];
  const settings = isPipeline ? {} : source.settings;

  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`gen-rowbtn ${open ? 'is-active' : ''}`}
        // A graph's settings are not this row's to offer, so the control is
        // dead rather than opening a panel that would have to apologise.
        disabled={!editable || isPipeline || !model}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Settings for ${jobTitle(job.draft)}`}
        title={isPipeline ? 'The pipeline owns these settings' : 'Settings'}
        onClick={toggle}
      >
        <SlidersIcon size={14} />
      </button>

      <RowPopover open={open} anchor={anchor} onClose={close} label="Job settings" width={252} className="gen-params">
        {model && (
          <>
            <span className="gen-popover-title">Quality</span>
            <QualityPicker model={model} settings={settings} onChange={patchSettings} disabled={!editable} />

            {plain.map((setting) => (
              <SettingField
                key={setting.key}
                setting={setting}
                value={settings[setting.key]}
                onChange={(value) => patchSettings({ ...settings, [setting.key]: value })}
              />
            ))}

            <div className="pipe-field row">
              <span className="pipe-field-label">Remove background</span>
              <Form.Toggle
                size="sm"
                checked={!isPipeline && source.removeBackground}
                aria-label="Remove background"
                onChange={(removeBackground) =>
                  !isPipeline && void generationStore.updateJob(job.id, { source: { ...source, removeBackground } })
                }
              />
            </div>

            <div className="pipe-field">
              <span className="pipe-field-label">Save as</span>
              <Form.Segmented
                size="sm"
                fullWidth
                options={FORMATS}
                value={job.draft.format}
                onChange={(format) => void generationStore.updateJob(job.id, { format })}
              />
            </div>

            {advanced.length > 0 && (
              <div className="gen-disclosure">
                <button
                  type="button"
                  className="gen-disclosure-btn"
                  aria-expanded={showAdvanced}
                  onClick={() => setShowAdvanced((v) => !v)}
                >
                  <ChevronDownIcon size={12} className={`gen-chevron ${showAdvanced ? 'is-open' : ''}`} />
                  Advanced
                </button>
                {showAdvanced &&
                  advanced.map((setting) => (
                    <SettingField
                      key={setting.key}
                      setting={setting}
                      value={settings[setting.key]}
                      onChange={(value) => patchSettings({ ...settings, [setting.key]: value })}
                    />
                  ))}
              </div>
            )}
          </>
        )}

        {isPipeline && (
          <>
            <p className="gen-popover-note">The pipeline decides these. Open it to change them.</p>
            <button
              type="button"
              className="gen-link"
              onClick={() => {
                close();
                dockStore.setActiveItem('pipelines');
              }}
            >
              Open the editor
            </button>
          </>
        )}
      </RowPopover>
    </>
  );
};
