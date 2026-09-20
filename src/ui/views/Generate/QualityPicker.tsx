import React from 'react';
import type { ModelDefinition } from '../../../core/models';
import { applyQuality, detectQuality, QUALITY_PRESETS } from '../../../core/quality';
import { Tooltip } from '../../components';

export interface QualityPickerProps {
  model: ModelDefinition;
  settings: Record<string, number | string | boolean>;
  onChange: (settings: Record<string, number | string | boolean>) => void;
  disabled?: boolean;
}

/**
 * The only dial most people want, at the top of the settings the rest of them
 * live in.
 *
 * Steps, guidance and octree resolution are the node editor's language, so the
 * one question a normal user actually has — "can it be quicker, can it be
 * sharper?" — had nowhere to be asked. A preset is not a mode: it writes real
 * numbers into the same settings object the fields below it show, so the two
 * can never disagree and anyone can see exactly what the preset did.
 *
 * Settings nudged by hand read as Custom rather than snapping to the nearest
 * preset; picking one then overwrites them, which is the point of picking one.
 */
export const QualityPicker: React.FC<QualityPickerProps> = ({ model, settings, onChange, disabled = false }) => {
  const active = detectQuality(model, settings);

  return (
    <div className="gen-quality" role="group" aria-label="Quality">
      {QUALITY_PRESETS.map((preset) => (
        <Tooltip key={preset.value} content={preset.hint} position="top">
          <button
            type="button"
            className={`gen-quality-btn ${active === preset.value ? 'is-active' : ''}`}
            aria-pressed={active === preset.value}
            disabled={disabled}
            onClick={() => onChange(applyQuality(model, preset.value, settings))}
          >
            {preset.label}
          </button>
        </Tooltip>
      ))}
      {active === null && <span className="gen-quality-custom">Custom</span>}
    </div>
  );
};
