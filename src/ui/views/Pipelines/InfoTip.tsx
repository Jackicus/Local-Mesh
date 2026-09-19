import React, { useId, useState } from 'react';
import { Tooltip } from '../../components';
import { InfoIcon } from '../../assets/icons';

export interface InfoTipProps {
  /** The explanation. Nothing renders when it is empty — a self-evident control gets no mark. */
  text?: React.ReactNode;
  /** What is being explained, for the button's accessible name. */
  label: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

/**
 * The "(i)" the whole node editor explains itself through. Two problems make
 * this more than a Tooltip call:
 *
 * 1. Position. The mark sits inside `.pipe-world`, which the canvas pans and
 *    zooms with a CSS transform, so an absolutely-positioned bubble would be
 *    scaled with the node (illegible at 0.4, huge at 2) and clipped by the
 *    canvas. `portal` hands the bubble to document.body at fixed viewport
 *    coordinates instead: one size at every zoom, above every node and wire,
 *    clamped into the window.
 * 2. Interaction. The node header starts a drag on pointerdown and the card
 *    selects on pointerdown/focus. Every relevant event is stopped here — and
 *    pointerdown is also defaulted away, so clicking the mark never pulls
 *    focus out of an input someone is mid-edit in.
 *
 * Escape suppresses the bubble while the mark keeps focus; leaving or blurring
 * arms it again. A wheel over the mark suppresses it too: zooming moves the
 * anchor out from under a bubble that is no longer in the same coordinate
 * space, and re-entering the mark brings it back.
 */
export const InfoTip: React.FC<InfoTipProps> = ({ text, label, position = 'top', className = '' }) => {
  const [suppressed, setSuppressed] = useState(false);
  const id = useId();
  if (!text) return null;

  return (
    <span
      className={`pipe-info-slot ${className}`}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.stopPropagation()}
      onWheelCapture={() => setSuppressed(true)}
      onPointerLeave={() => setSuppressed(false)}
      onBlur={() => setSuppressed(false)}
    >
      <Tooltip content={text} position={position} delay={120} disabled={suppressed} portal bubbleClassName="pipe-info-bubble">
        <button
          type="button"
          className="pipe-info"
          aria-label={`About ${label}`}
          aria-describedby={id}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            setSuppressed(true);
          }}
        >
          <InfoIcon size={12} aria-hidden="true" />
        </button>
      </Tooltip>
      {/* The bubble is decorative to assistive tech (it comes and goes with the
          pointer); this is the copy aria-describedby actually resolves. */}
      <span id={id} className="pipe-info-sr">
        {text}
      </span>
    </span>
  );
};

export interface FieldLabelProps {
  label: string;
  /** Shown behind the label's (i); omit for a control that explains itself. */
  info?: React.ReactNode;
}

/** A `.pipe-field` label with its optional info mark. */
export const FieldLabel: React.FC<FieldLabelProps> = ({ label, info }) => (
  <span className="pipe-field-label">
    {label}
    <InfoTip text={info} label={label} />
  </span>
);
