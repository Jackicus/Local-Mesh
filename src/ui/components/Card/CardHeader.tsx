import React from 'react';

export interface CardHeaderProps {
  title?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

export const CardHeader: React.FC<CardHeaderProps> = ({
  title,
  subtitle,
  icon,
  action,
  className = '',
  children,
}) => {
  return (
    <div className={`ui-card-header ${className}`}>
      {children || (
        <>
          <div className="ui-card-title-group">
            {icon && <span className="ui-card-icon">{icon}</span>}
            <div>
              {title && <h3 className="ui-card-title">{title}</h3>}
              {subtitle && <p className="ui-card-subtitle">{subtitle}</p>}
            </div>
          </div>
          {action && <div className="ui-card-action">{action}</div>}
        </>
      )}
    </div>
  );
};
