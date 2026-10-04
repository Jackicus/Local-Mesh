import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

const KEY = 'local-mesh:queue-width';
const DEFAULT_WIDTH = 560;
const MIN_WIDTH = 380;
/** Room the band must keep for Start and the tool plates beside the queue. */
const PLATES_ROOM = 340;
const KEY_STEP = 24;

function read(): number {
  try {
    const n = Number(localStorage.getItem(KEY));
    return Number.isFinite(n) && n >= MIN_WIDTH ? n : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function write(width: number): void {
  try {
    localStorage.setItem(KEY, String(Math.round(width)));
  } catch {
    // A convenience; without storage it is simply the default next time.
  }
}

/**
 * The queue plate's width, set by dragging its right edge and remembered per
 * viewer. The band's own width bounds it, so a drag can never push Start and
 * the tool plates off the side; a narrower window clamps it by CSS instead,
 * without forgetting what was chosen.
 */
export function useQueueWidth(rootRef: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(read);
  const [resizing, setResizing] = useState(false);
  const start = useRef<{ x: number; width: number } | null>(null);

  const clamp = useCallback(
    (value: number) => {
      const band = rootRef.current?.parentElement?.clientWidth ?? Infinity;
      return Math.round(Math.max(MIN_WIDTH, Math.min(value, band - PLATES_ROOM)));
    },
    [rootRef]
  );

  useEffect(() => {
    if (!resizing) return;
    const onMove = (event: PointerEvent) => {
      if (!start.current) return;
      setWidth(clamp(start.current.width + event.clientX - start.current.x));
    };
    const onUp = () => {
      start.current = null;
      setResizing(false);
      setWidth((w) => {
        write(w);
        return w;
      });
    };
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [resizing, clamp]);

  const handleProps = {
    role: 'separator' as const,
    'aria-orientation': 'vertical' as const,
    'aria-label': 'Resize the queue',
    'aria-valuenow': width,
    tabIndex: 0,
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      // Start from what is drawn, which a narrow window may have clamped.
      const drawn = rootRef.current?.getBoundingClientRect().width ?? width;
      start.current = { x: event.clientX, width: drawn };
      setResizing(true);
    },
    onDoubleClick: () => {
      setWidth(clamp(DEFAULT_WIDTH));
      write(DEFAULT_WIDTH);
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const next = clamp(width + (event.key === 'ArrowRight' ? KEY_STEP : -KEY_STEP));
      setWidth(next);
      write(next);
    },
  };

  return { width, resizing, handleProps };
}
