import React, { useState } from 'react';
import type { MeshGeneratorData } from '../../../../core/pipeline';
import { MODELS, defaultModelSettings, getModel } from '../../../../core/models';
import { Form } from '../../../components';
import { ChevronRightIcon } from '../../../assets/icons';
import { useModelStore } from '../../../stores/modelStore';
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

  return (
    <>
      <div className="pipe-field">
        <span className="pipe-field-label">Model</span>
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
          <button
            type="button"
            className={`pipe-disclosure-btn ${advancedOpen ? 'open' : ''}`}
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((o) => !o)}
          >
            <ChevronRightIcon size={12} />
            Advanced
          </button>
          {advancedOpen &&
            advanced.map((s) => (
              <SettingField key={s.key} setting={s} value={data.settings?.[s.key]} onChange={(v) => setSetting(s.key, v)} />
            ))}
        </div>
      )}
    </>
  );
};
