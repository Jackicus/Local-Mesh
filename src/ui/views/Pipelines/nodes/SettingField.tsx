import React from 'react';
import type { ModelSetting } from '../../../../core/models';
import { Form } from '../../../components';
import { DiceIcon } from '../../../assets/icons';

type SettingValue = number | string | boolean;

interface SettingFieldProps {
  setting: ModelSetting;
  value: SettingValue | undefined;
  onChange: (value: SettingValue) => void;
}

/** Ranges with at most this many steps get a slider; larger ones a number box. */
const SLIDER_MAX_STEPS = 100;

/** One control generated from a registry `ModelSetting`. */
export const SettingField: React.FC<SettingFieldProps> = ({ setting, value, onChange }) => {
  const current = value ?? setting.default;
  const label = (
    <span className="pipe-field-label" title={setting.description}>
      {setting.label}
    </span>
  );

  if (setting.type === 'boolean') {
    return (
      <div className="pipe-field row">
        {label}
        <Form.Toggle size="sm" checked={Boolean(current)} onChange={onChange} aria-label={setting.label} />
      </div>
    );
  }

  if (setting.type === 'select') {
    const options = setting.options ?? [];
    return (
      <div className="pipe-field">
        {label}
        <Form.Select
          size="sm"
          aria-label={setting.label}
          options={options.map((o) => ({ value: String(o.value), label: o.label }))}
          value={String(current)}
          onChange={(e) => {
            // <select> yields strings; hand back the registry's typed value.
            const match = options.find((o) => String(o.value) === e.target.value);
            onChange(match ? match.value : e.target.value);
          }}
        />
      </div>
    );
  }

  const num = typeof current === 'number' ? current : Number(current);
  const numberInput = (
    <Form.Input
      size="sm"
      type="number"
      aria-label={setting.label}
      min={setting.min}
      max={setting.max}
      step={setting.step}
      value={Number.isFinite(num) ? num : ''}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (e.target.value !== '' && Number.isFinite(n)) onChange(n);
      }}
    />
  );

  if (setting.type === 'seed') {
    return (
      <div className="pipe-field">
        {label}
        <div className="pipe-field-inline">
          {numberInput}
          <button
            type="button"
            className="pipe-icon-btn"
            title="Random seed every job (-1)"
            aria-label="Use a random seed"
            onClick={() => onChange(-1)}
          >
            <DiceIcon size={14} />
          </button>
        </div>
        {num === -1 && <span className="pipe-hint">random per job</span>}
      </div>
    );
  }

  const { min, max, step = 1 } = setting;
  const sliderable = min !== undefined && max !== undefined && (max - min) / step <= SLIDER_MAX_STEPS;
  return (
    <div className="pipe-field">
      {label}
      {sliderable ? (
        <Form.Slider min={min} max={max} step={step} value={Number.isFinite(num) ? num : min} onChange={onChange} aria-label={setting.label} />
      ) : (
        numberInput
      )}
    </div>
  );
};
