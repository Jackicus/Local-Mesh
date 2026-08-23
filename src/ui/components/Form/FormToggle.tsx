import React from 'react';

export interface FormToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  'aria-label'?: string;
  ariaLabel?: string;
  className?: string;
}

export const FormToggle: React.FC<FormToggleProps> = ({
  checked,
  onChange,
  disabled = false,
  size = 'md',
  'aria-label': ariaLabelAttr,
  ariaLabel,
  className = '',
}) => {
  const handleClick = () => {
    if (!disabled) {
      onChange(!checked);
    }
  };

  const label = ariaLabelAttr || ariaLabel || 'Toggle switch';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={handleClick}
      className={`ui-toggle ui-toggle-${size} ${checked ? 'checked' : ''} ${
        disabled ? 'disabled' : ''
      } ${className}`}
    >
      <span className="ui-toggle-thumb" />
    </button>
  );
};
