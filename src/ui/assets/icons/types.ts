import React from 'react';

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
  color?: string;
  strokeWidth?: number;
  className?: string;
}

export type IconComponent = React.FC<IconProps>;
