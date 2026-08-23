import React from 'react';

export interface SegmentedOption<T extends string = string> {
  value: T;
  label?: React.ReactNode;
  icon?: React.ReactNode;
  title?: string;
  disabled?: boolean;
}

export interface FormSegmentedProps<T extends string = string> {
  options: Array<SegmentedOption<T> | T>;
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  fullWidth?: boolean;
  disabled?: boolean;
  className?: string;
}

export function FormSegmented<T extends string = string>({
  options,
  value,
  onChange,
  size = 'md',
  fullWidth = false,
  disabled = false,
  className = '',
}: FormSegmentedProps<T>) {
  return (
    <div
      className={`ui-segmented ui-segmented-${size} ${fullWidth ? 'full-width' : ''} ${
        disabled ? 'disabled' : ''
      } ${className}`}
      role="radiogroup"
    >
      {options.map((opt) => {
        const optionObj: SegmentedOption<T> =
          typeof opt === 'string' ? { value: opt as T, label: opt } : opt;

        const isSelected = optionObj.value === value;
        const isItemDisabled = disabled || optionObj.disabled;

        return (
          <button
            key={optionObj.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={typeof optionObj.label === 'string' ? optionObj.label : optionObj.value}
            title={optionObj.title}
            disabled={isItemDisabled}
            className={`ui-segmented-item ${isSelected ? 'selected' : ''}`}
            onClick={() => {
              if (!isItemDisabled && !isSelected) {
                onChange(optionObj.value);
              }
            }}
          >
            {optionObj.icon && <span className="ui-segmented-icon">{optionObj.icon}</span>}
            {optionObj.label && <span className="ui-segmented-label">{optionObj.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
