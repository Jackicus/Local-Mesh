import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface RowPopoverProps {
  open: boolean;
  /** The control the panel hangs off. */
  anchor: HTMLElement | null;
  onClose: () => void;
  /** Accessible name for the dialog. */
  label: string;
  /** Wider than the default 220px where the content needs it. */
  width?: number;
  className?: string;
  children: React.ReactNode;
}

const MARGIN = 8;
const GAP = 6;

/**
 * The panel a control on a queue row opens.
 *
 * Every other floating surface in this view is absolutely positioned inside
 * its own plate, which works because those plates do not scroll. The queue
 * does: it is a scrolling list inside a clipping plate, so a panel positioned
 * inside a row would be cut off at the plate's edge and would drift as the
 * list scrolled under it. This portals to the body at fixed coordinates
 * instead — measured from the anchor, flipped above the row when there is no
 * room below, and clamped into the window — and re-measures on anything that
 * can move the anchor, including a scroll of the list it lives in (hence the
 * capturing listener; the list's scroll does not bubble).
 */
export const RowPopover: React.FC<RowPopoverProps> = ({
  open,
  anchor,
  onClose,
  label,
  width = 220,
  className = '',
  children,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const place = useCallback(() => {
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const a = anchor.getBoundingClientRect();
    const height = panel.offsetHeight;
    const below = window.innerHeight - a.bottom - GAP - MARGIN;
    const top = height <= below ? a.bottom + GAP : Math.max(MARGIN, a.top - GAP - height);
    const left = Math.min(Math.max(MARGIN, a.left), window.innerWidth - width - MARGIN);
    setPos({ top, left });
  }, [anchor, width]);

  // Measured and placed inside one layout effect, so the panel is never
  // painted at the top-left corner before it lands.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
  }, [open, place, children]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => place();
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchor?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, anchor, place, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      ref={panelRef}
      className={`gen-rowpop ${className}`}
      role="dialog"
      aria-label={label}
      style={{
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        width,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body
  );
};

/** Open/closed state plus the anchor ref, which every caller of RowPopover needs. */
export function usePopover(): {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  close: () => void;
  ref: React.RefObject<HTMLButtonElement | null>;
  anchor: HTMLElement | null;
} {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  return { open, setOpen, toggle, close, ref, anchor: ref.current };
}
