import React from 'react';

export interface ModalFooterProps {
  children: React.ReactNode;
  align?: 'right' | 'left' | 'space-between';
  className?: string;
}

export const ModalFooter: React.FC<ModalFooterProps> = ({
  children,
  align = 'right',
  className = '',
}) => {
  return (
    <div className={`ui-modal-footer ui-modal-footer-${align} ${className}`}>
      {children}
    </div>
  );
};
