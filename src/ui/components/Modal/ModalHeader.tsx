import React from 'react';
import { CloseIcon } from '../../assets/icons';

export interface ModalHeaderProps {
  title?: React.ReactNode;
  /** id linking the h2 to the dialog's aria-labelledby (set by Modal) */
  titleId?: string;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  onClose?: () => void;
  children?: React.ReactNode;
  className?: string;
}

export const ModalHeader: React.FC<ModalHeaderProps> = ({
  title,
  titleId,
  subtitle,
  icon,
  onClose,
  children,
  className = '',
}) => {
  return (
    <div className={`ui-modal-header ${className}`}>
      {icon && <span className="ui-modal-header-icon">{icon}</span>}

      <div className="ui-modal-header-text">
        {title && <h2 id={titleId} className="ui-modal-title">{title}</h2>}
        {subtitle && <p className="ui-modal-subtitle">{subtitle}</p>}
        {children}
      </div>

      {onClose && (
        <button
          type="button"
          className="ui-modal-close"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <CloseIcon size={16} />
        </button>
      )}
    </div>
  );
};
