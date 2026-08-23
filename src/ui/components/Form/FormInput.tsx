import React from 'react';

export interface FormInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  icon?: React.ReactNode;
  action?: React.ReactNode;
  size?: 'sm' | 'md';
  error?: boolean;
}

export const FormInput: React.FC<FormInputProps> = ({
  icon,
  action,
  size = 'md',
  error = false,
  className = '',
  disabled,
  ...props
}) => {
  return (
    <div
      className={`ui-input-wrapper ui-input-${size} ${error ? 'has-error' : ''} ${
        disabled ? 'disabled' : ''
      } ${className}`}
    >
      {icon && <span className="ui-input-icon">{icon}</span>}
      <input
        className="ui-input-field"
        disabled={disabled}
        {...props}
      />
      {action && <div className="ui-input-action">{action}</div>}
    </div>
  );
};
