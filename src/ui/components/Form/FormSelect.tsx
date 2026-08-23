import React from 'react';
import { ChevronDownIcon } from '../../assets/icons';

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

export interface FormSelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  options: Array<SelectOption | string>;
  placeholder?: string;
  size?: 'sm' | 'md';
  error?: boolean;
}

export const FormSelect: React.FC<FormSelectProps> = ({
  options,
  placeholder,
  size = 'md',
  error = false,
  className = '',
  disabled,
  ...props
}) => {
  return (
    <div
      className={`ui-select-wrapper ui-select-${size} ${error ? 'has-error' : ''} ${
        disabled ? 'disabled' : ''
      } ${className}`}
    >
      <select
        className="ui-select-field"
        disabled={disabled}
        {...props}
      >
        {placeholder && (
          <option value="" disabled hidden>
            {placeholder}
          </option>
        )}
        {options.map((opt) => {
          const optionObj: SelectOption =
            typeof opt === 'string' ? { value: opt, label: opt } : opt;

          return (
            <option
              key={String(optionObj.value)}
              value={optionObj.value}
              disabled={optionObj.disabled}
            >
              {optionObj.label}
            </option>
          );
        })}
      </select>
      <span className="ui-select-chevron" aria-hidden="true">
        <ChevronDownIcon size={14} />
      </span>
    </div>
  );
};
