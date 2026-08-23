import React, { forwardRef } from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'subtle' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  /** Stretch to the container's full width; combine several in a `.ui-btn-row` for a distributed row */
  fullWidth?: boolean;
  children?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  type = 'button',
  variant = 'secondary',
  size = 'md',
  icon,
  fullWidth = false,
  children,
  className = '',
  ...props
}, ref) => {
  return (
    <button
      ref={ref}
      type={type}
      className={`btn btn-${variant} btn-${size} ${fullWidth ? 'btn-full' : ''} ${className}`}
      {...props}
    >
      {icon && <span className="btn-icon">{icon}</span>}
      {children && <span>{children}</span>}
    </button>
  );
});

Button.displayName = 'Button';
