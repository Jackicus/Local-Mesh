import React from 'react';
import { CardHeader } from './CardHeader';
import { CardExpandableHeader } from './CardExpandableHeader';
import { CardBody } from './CardBody';
import { CardFooter } from './CardFooter';

export interface CardProps {
  title?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

interface CardComponent extends React.FC<CardProps> {
  Header: typeof CardHeader;
  ExpandableHeader: typeof CardExpandableHeader;
  Body: typeof CardBody;
  Footer: typeof CardFooter;
}

export const Card: CardComponent = ({
  title,
  subtitle,
  icon,
  action,
  children,
  className = '',
}) => {
  // If shorthand props (title/subtitle/icon/action) are provided, wrap automatically
  const hasShorthandHeader = Boolean(title || subtitle || icon || action);

  return (
    <div className={`ui-card ${className}`}>
      {hasShorthandHeader && (
        <CardHeader
          title={title}
          subtitle={subtitle}
          icon={icon}
          action={action}
        />
      )}
      {hasShorthandHeader ? (
        <CardBody>{children}</CardBody>
      ) : (
        children
      )}
    </div>
  );
};

Card.Header = CardHeader;
Card.ExpandableHeader = CardExpandableHeader;
Card.Body = CardBody;
Card.Footer = CardFooter;
