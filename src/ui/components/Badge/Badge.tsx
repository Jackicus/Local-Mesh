import React from 'react';

export interface BadgeProps {
  variant?: 'accent' | 'neutral' | 'success' | 'warning' | 'danger';
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'accent',
  icon,
  children,
  className = '',
}) => {
  return (
    <span className={`ui-badge ui-badge-${variant} ${className}`}>
      {icon && <span className="ui-badge-icon">{icon}</span>}
      <span>{children}</span>
    </span>
  );
};
