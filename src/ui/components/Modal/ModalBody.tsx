import React from 'react';

export interface ModalBodyProps {
  children: React.ReactNode;
  className?: string;
}

export const ModalBody: React.FC<ModalBodyProps> = ({
  children,
  className = '',
}) => {
  return <div className={`ui-modal-body ${className}`}>{children}</div>;
};
