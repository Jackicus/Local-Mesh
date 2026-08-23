import React from 'react';
import { CheckIcon } from '../../assets/icons';

export interface FormCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  isRow?: boolean;
  className?: string;
}

export const FormCheckbox: React.FC<FormCheckboxProps> = ({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  isRow = false,
  className = '',
}) => {
  const baseClass = isRow ? 'ui-checkbox-row' : 'ui-checkbox-label';

  return (
    <label
      className={`${baseClass} ${disabled ? 'disabled' : ''} ${className}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="ui-checkbox-native"
      />
      <span className={`ui-checkbox-custom ${checked ? 'checked' : ''}`}>
        {checked && <CheckIcon size={12} strokeWidth={3} />}
      </span>

      {(label || description) && (
        <div className="ui-checkbox-text">
          {label && <span className="ui-checkbox-title">{label}</span>}
          {description && <span className="ui-checkbox-desc">{description}</span>}
        </div>
      )}
    </label>
  );
};
