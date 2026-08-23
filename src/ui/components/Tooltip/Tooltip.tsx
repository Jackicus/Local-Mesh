import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';

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
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [shift, setShift] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  // Clamp horizontally into the viewport: measure once on show (before paint)
  // and apply a corrective shift so the bubble can't hang off a window edge
  useLayoutEffect(() => {
    if (!isVisible) {
      setShift(0);
      return;
    }
    const rect = bubbleRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pad = 8;
    if (rect.left < pad) {
      setShift(pad - rect.left);
    } else if (rect.right > window.innerWidth - pad) {
      setShift(window.innerWidth - pad - rect.right);
    }
  }, [isVisible]);

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

  return (
    <div
      className={`ui-tooltip-wrapper ${className}`}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      {children}

      {isVisible && !disabled && (
        <div
          ref={bubbleRef}
          className={`ui-tooltip-bubble ui-tooltip-${position} ${align !== 'center' ? `ui-tooltip-align-${align}` : ''}`}
          style={{ '--tooltip-shift': `${shift}px` } as React.CSSProperties}
          role="tooltip"
        >
          <span className="ui-tooltip-text">{content}</span>
          {shortcut && <kbd className="ui-tooltip-shortcut">{shortcut}</kbd>}
        </div>
      )}
    </div>
  );
};
