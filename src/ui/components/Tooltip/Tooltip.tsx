import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

export interface TooltipProps {
  content: React.ReactNode;
  shortcut?: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  /** Horizontal anchor for top/bottom tooltips; use 'start'/'end' near window edges so the bubble can't clip offscreen */
  align?: 'center' | 'start' | 'end';
  delay?: number;
  disabled?: boolean;
  children: React.ReactElement;
  className?: string;
  /**
   * Render the bubble into document.body at fixed viewport coordinates
   * instead of absolutely inside the wrapper. For triggers that live in a
   * transformed or clipping container (the pipeline canvas scales its world),
   * where an absolute bubble would be scaled with it or cut off.
   */
  portal?: boolean;
  /** Extra class on the bubble itself — the only hook a portalled bubble has, since it leaves the caller's subtree. */
  bubbleClassName?: string;
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  shortcut,
  position = 'top',
  align = 'center',
  delay = 150,
  disabled = false,
  children,
  className = '',
  portal = false,
  bubbleClassName = '',
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [shift, setShift] = useState(0);
  const [fixed, setFixed] = useState<{ top: number; left: number } | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Clamp horizontally into the viewport: measure once on show (before paint)
  // and apply a corrective shift so the bubble can't hang off a window edge
  useLayoutEffect(() => {
    if (!isVisible) {
      setShift(0);
      setFixed(null);
      return;
    }
    const rect = bubbleRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pad = 8;
    if (portal) {
      // Measured at 0,0 on the first pass, then placed: both happen inside one
      // layout effect, so the bubble is never painted in the wrong spot.
      const anchor = wrapperRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const gap = 6;
      const midX = anchor.left + anchor.width / 2 - rect.width / 2;
      const midY = anchor.top + anchor.height / 2 - rect.height / 2;
      let top = anchor.top - gap - rect.height;
      let left = midX;
      if (position === 'bottom') top = anchor.bottom + gap;
      else if (position === 'left') {
        top = midY;
        left = anchor.left - gap - rect.width;
      } else if (position === 'right') {
        top = midY;
        left = anchor.right + gap;
      }
      // Flip vertically rather than clamp over the trigger when there is no room.
      if (position === 'top' && top < pad) top = anchor.bottom + gap;
      if (position === 'bottom' && top + rect.height > window.innerHeight - pad) top = anchor.top - gap - rect.height;
      const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), Math.max(lo, hi));
      setFixed({
        top: clamp(top, pad, window.innerHeight - pad - rect.height),
        left: clamp(left, pad, window.innerWidth - pad - rect.width),
      });
      return;
    }
    if (rect.left < pad) {
      setShift(pad - rect.left);
    } else if (rect.right > window.innerWidth - pad) {
      setShift(window.innerWidth - pad - rect.right);
    }
  }, [isVisible, portal, position]);

  const showTooltip = () => {
    if (disabled || !content) return;
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
    }, delay);
  };

  const hideTooltip = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsVisible(false);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // Escape dismisses the bubble without moving focus (WCAG 1.4.13): a keyboard
  // user who tabbed onto the trigger can get the bubble out of the way, and a
  // bubble left over a trigger that unmounts its own hover target can't linger
  useEffect(() => {
    if (!isVisible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsVisible(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isVisible]);

  const bubble = (
    <div
      ref={bubbleRef}
      className={
        portal
          ? `ui-tooltip-bubble ui-tooltip-portal ${bubbleClassName}`
          : `ui-tooltip-bubble ui-tooltip-${position} ${align !== 'center' ? `ui-tooltip-align-${align}` : ''} ${bubbleClassName}`
      }
      style={
        portal
          ? { position: 'fixed', top: fixed?.top ?? 0, left: fixed?.left ?? 0, visibility: fixed ? 'visible' : 'hidden' }
          : ({ '--tooltip-shift': `${shift}px` } as React.CSSProperties)
      }
      role="tooltip"
    >
      <span className="ui-tooltip-text">{content}</span>
      {shortcut && <kbd className="ui-tooltip-shortcut">{shortcut}</kbd>}
    </div>
  );

  return (
    <div
      ref={wrapperRef}
      className={`ui-tooltip-wrapper ${className}`}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      {children}

      {isVisible && !disabled && (portal ? createPortal(bubble, document.body) : bubble)}
    </div>
  );
};
