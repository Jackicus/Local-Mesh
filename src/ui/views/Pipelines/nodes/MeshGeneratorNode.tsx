import React, { useState } from 'react';
import type { MeshGeneratorData } from '../../../../core/pipeline';
import { MODELS, defaultModelSettings, getModel } from '../../../../core/models';
import { Form } from '../../../components';
import { ChevronRightIcon } from '../../../assets/icons';
import { useModelStore } from '../../../stores/modelStore';
import { FieldLabel, InfoTip } from '../InfoTip';
import { SettingField } from './SettingField';
import type { NodeBodyProps } from './types';

export const MeshGeneratorNode: React.FC<NodeBodyProps<MeshGeneratorData>> = ({ data, onChange }) => {
  const [modelState] = useModelStore();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const model = getModel(data.modelId);

  const options = MODELS.map((m) => {
    const installed = m.id === 'mock' || modelState.installs[m.id]?.ready;
    return { value: m.id, label: installed ? m.name : `${m.name} (not installed)` };
  });

  const setSetting = (key: string, value: number | string | boolean) =>
    onChange({ settings: { ...(data.settings ?? {}), [key]: value } });

  const basic = model?.settings.filter((s) => !s.advanced) ?? [];
  const advanced = model?.settings.filter((s) => s.advanced) ?? [];
  const installed = model ? model.id === 'mock' || Boolean(modelState.installs[model.id]?.ready) : false;

  // What the picker is choosing between, in the selected model's own terms:
  // the node's hint line only has room for the numbers.
  const modelInfo = model ? (
    <>
      <span className="pipe-info-line">{model.description}</span>
      {model.vramGb > 0 && (
        <span className="pipe-info-line">
          {model.vendor} · {model.params} params · ~{model.vramGb} GB VRAM · {model.diskGb} GB on disk · {model.license}
        </span>
      )}
      {!installed && <span className="pipe-info-line">Not installed: fetch its weights and dependencies in the Models view first.</span>}
    </>
  ) : (
    'Which image-to-3D model turns the image into a mesh. Bigger models buy sharper geometry with VRAM and time; only installed models can run.'
  );

  return (
    <>
      <div className="pipe-field">
        <FieldLabel label="Model" info={modelInfo} />
        <Form.Select
          size="sm"
          aria-label="Model"
          options={options}
          value={model ? data.modelId : ''}
          placeholder={model ? undefined : 'Choose a model'}
          onChange={(e) => {
            const next = getModel(e.target.value);
            if (next) onChange({ modelId: next.id, settings: defaultModelSettings(next) });
          }}
        />
        {model && (
          <span className="pipe-hint">
            {model.params} · {model.vramGb} GB VRAM · {model.tags.join(', ')}
          </span>
        )}
      </div>

      {basic.map((s) => (
        <SettingField key={s.key} setting={s} value={data.settings?.[s.key]} onChange={(v) => setSetting(s.key, v)} />
      ))}

      {advanced.length > 0 && (
        <div className="pipe-disclosure">
          <div className="pipe-disclosure-head">
            <button
              type="button"
              className={`pipe-disclosure-btn ${advancedOpen ? 'open' : ''}`}
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((o) => !o)}
            >
              <ChevronRightIcon size={12} />
              Advanced
            </button>
            <InfoTip
              label="the advanced settings"
              text="Settings most jobs never touch: memory-for-speed trade-offs, and a knob or two for rescuing a mesh that came out wrong."
            />
          </div>
          {advancedOpen &&
            advanced.map((s) => (
              <SettingField key={s.key} setting={s} value={data.settings?.[s.key]} onChange={(v) => setSetting(s.key, v)} />
            ))}
        </div>
      )}
    </>
  );
};
