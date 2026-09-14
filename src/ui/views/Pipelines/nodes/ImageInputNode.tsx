import React, { useEffect, useState } from 'react';
import type { ImageInputData } from '../../../../core/pipeline';
import { Button } from '../../../components';
import { CloseIcon, ImageIcon } from '../../../assets/icons';
import type { NodeBodyProps } from './types';

const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;

export const ImageInputNode: React.FC<NodeBodyProps<ImageInputData>> = ({ data, onChange }) => {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  const [thumb, setThumb] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setThumb(null);
    if (!data.imagePath || !api) return;
    void api.readImageDataUrl(data.imagePath).then((url) => {
      if (!cancelled) setThumb(url);
    });
    return () => {
      cancelled = true;
    };
  }, [data.imagePath, api]);

  const choose = async () => {
    const picked = await api?.pickImages();
    const first = picked?.[0];
    if (first) onChange({ imagePath: first });
  };

  if (!data.imagePath) {
    return (
      <>
        <p className="pipe-note">Picked at generate time</p>
        <div className="pipe-field">
          <span className="pipe-field-label">Fixed image (optional)</span>
          <Button size="sm" variant="secondary" icon={<ImageIcon size={14} />} onClick={choose} disabled={!api} title={api ? undefined : 'Needs the desktop app'}>
            Choose…
          </Button>
        </div>
      </>
    );
  }

  return (
    <div className="pipe-image-pick">
      <div className="pipe-thumb" aria-hidden="true">
        {thumb ? <img src={thumb} alt="" /> : <ImageIcon size={18} />}
      </div>
      <div className="pipe-image-meta">
        <span className="pipe-image-name" title={data.imagePath}>
          {basename(data.imagePath)}
        </span>
        <span className="pipe-note">Fixed image</span>
      </div>
      <button type="button" className="pipe-icon-btn" aria-label="Clear fixed image" onClick={() => onChange({ imagePath: null })}>
        <CloseIcon size={14} />
      </button>
    </div>
  );
};
