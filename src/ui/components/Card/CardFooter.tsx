import React from 'react';

export interface CardFooterProps {
  className?: string;
  children?: React.ReactNode;
}

export const CardFooter: React.FC<CardFooterProps> = ({
  className = '',
  children,
}) => {
  return <div className={`ui-card-footer ${className}`}>{children}</div>;
};
