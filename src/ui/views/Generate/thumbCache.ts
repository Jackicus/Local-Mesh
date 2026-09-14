import { useEffect, useState } from 'react';
import { api } from '../../stores/createStore';

/**
 * Data-URL thumbnails for input images, memoised per path so the queue and
 * the image strip don't re-read the same file on every render. Bounded so a
 * long session can't pin hundreds of images in memory.
 */
const MAX_ENTRIES = 160;
const cache = new Map<string, Promise<string | null>>();

export function thumbnailFor(path: string): Promise<string | null> {
  const hit = cache.get(path);
  if (hit) return hit;
  const electron = api();
  const pending = electron ? electron.readImageDataUrl(path).catch(() => null) : Promise.resolve(null);
  cache.set(path, pending);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return pending;
}

export function useThumbnail(path: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }
    let live = true;
    thumbnailFor(path).then((u) => {
      if (live) setUrl(u);
    });
    return () => {
      live = false;
    };
  }, [path]);
  return url;
}
