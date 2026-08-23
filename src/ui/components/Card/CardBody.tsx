import React from 'react';

export interface CardBodyProps {
  className?: string;
  children?: React.ReactNode;
}

export const CardBody: React.FC<CardBodyProps> = ({
  className = '',
  children,
}) => {
  return <div className={`ui-card-body ${className}`}>{children}</div>;
};
