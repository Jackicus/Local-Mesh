import React from 'react';
import { ImageIcon } from '../../assets/icons';
import { useThumbnail } from './thumbCache';
import { fileBaseName } from './format';

export interface ThumbnailProps {
  path: string;
}

/**
 * The source image on a job row. Small and square by design: it is there to
 * tell two jobs apart at a glance, not to be looked at — the picture itself is
 * one click away in whatever the user made it with.
 */
export const Thumbnail: React.FC<ThumbnailProps> = ({ path }) => {
  const url = useThumbnail(path);

  return (
    <span className="gen-thumb gen-thumb-xs" title={path}>
      {url ? (
        <img src={url} alt="" />
      ) : (
        <span className="gen-thumb-fallback" role="img" aria-label={fileBaseName(path)}>
          <ImageIcon size={11} />
        </span>
      )}
    </span>
  );
};
