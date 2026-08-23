import React from 'react';

export interface FormSliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  showValue?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
  ariaLabel?: string;
  className?: string;
}

export const FormSlider: React.FC<FormSliderProps> = ({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  unit = '',
  showValue = true,
  disabled = false,
  'aria-label': ariaLabelAttr,
  ariaLabel,
  className = '',
}) => {
  const label = ariaLabelAttr || ariaLabel || 'Range slider';

  return (
    <div
      className={`ui-slider-wrapper ${disabled ? 'disabled' : ''} ${className}`}
    >
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="ui-slider-input"
      />
      {showValue && (
        <span className="ui-slider-value">
          {value}{unit}
        </span>
      )}
    </div>
  );
};
