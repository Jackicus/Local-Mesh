import React from 'react';
import { ChevronDownIcon } from '../../assets/icons';

export interface CardExpandableHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
  className?: string;
}

export const CardExpandableHeader: React.FC<CardExpandableHeaderProps> = ({
  title,
  subtitle,
  icon,
  isExpanded,
  onToggle,
  action,
  className = '',
}) => {
  return (
    <div
      className={`ui-card-header ui-card-expandable-header ${className}`}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <div className="ui-card-title-group">
        {icon && <span className="ui-card-icon">{icon}</span>}
        <div>
          <h3 className="ui-card-title">{title}</h3>
          {subtitle && <p className="ui-card-subtitle">{subtitle}</p>}
        </div>
      </div>

      <div className="ui-card-action-group" onClick={(e) => e.stopPropagation()}>
        {action && <div className="ui-card-action">{action}</div>}
        <span className={`ui-card-chevron ${isExpanded ? 'expanded' : ''}`}>
          <ChevronDownIcon size={16} />
        </span>
      </div>
    </div>
  );
};
