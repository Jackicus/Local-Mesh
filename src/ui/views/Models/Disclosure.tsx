import React, { useState } from 'react';
import { ChevronDownIcon } from '../../assets/icons';

interface DisclosureProps {
  /** The always-visible line. Keep it short — it is a signpost, not a sentence. */
  summary: string;
  /** A quiet count or size on the right of the summary. */
  meta?: string;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * The one place detail hides in this view: expert readouts, raw setup output,
 * per-model specifics. Nothing a beginner needs to get started lives in here.
 */
export const Disclosure: React.FC<DisclosureProps> = ({
  summary,
  meta,
  defaultOpen = false,
  className = '',
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`models-disclosure ${className}`}>
      <button
        type="button"
        className={`models-disclosure-toggle ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <ChevronDownIcon size={14} className="models-disclosure-chevron" />
        <span>{summary}</span>
        {meta && <span className="models-disclosure-meta">{meta}</span>}
      </button>
      {open && <div className="models-disclosure-panel">{children}</div>}
    </div>
  );
};
