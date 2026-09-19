import React from 'react';
import { ImageIcon } from '../../assets/icons';
import { useThumbnail } from './thumbCache';
import { fileBaseName } from './format';

export interface ThumbnailProps {
  path: string;
  size?: 'xs' | 'sm' | 'md';
  onRemove?: () => void;
}

const FALLBACK_ICON = { xs: 11, sm: 13, md: 16 } as const;

/** The source image, wherever it needs to appear: staging strip or queue bar. */
export const Thumbnail: React.FC<ThumbnailProps> = ({ path, size = 'md', onRemove }) => {
  const url = useThumbnail(path);
  const name = fileBaseName(path);

  return (
    <div className={`gen-thumb gen-thumb-${size}`} title={path}>
      {url ? (
        <img src={url} alt={name} />
      ) : (
        <span className="gen-thumb-fallback">
          <ImageIcon size={FALLBACK_ICON[size]} />
        </span>
      )}
      {onRemove && (
        <button type="button" className="gen-thumb-remove" aria-label={`Remove ${name}`} onClick={onRemove}>
          ×
        </button>
      )}
    </div>
  );
};
