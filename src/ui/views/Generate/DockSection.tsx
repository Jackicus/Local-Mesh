import React, { useState } from 'react';
import { ChevronDownIcon } from '../../assets/icons';

export interface DockSectionProps {
  title: string;
  /** Shown beside the title in the mono voice — a count, a size, a state. */
  meta?: React.ReactNode;
  action?: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/**
 * One band of the dock. Titles are set like the app's other annotations
 * (mono, uppercase, tracked) so the panel reads as instrument labelling.
 */
export const DockSection: React.FC<DockSectionProps> = ({
  title,
  meta,
  action,
  collapsible = false,
  defaultOpen = true,
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const expanded = !collapsible || open;

  return (
    <section className="gen-section">
      <header className="gen-section-head">
        {collapsible ? (
          <button
            type="button"
            className="gen-section-toggle"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronDownIcon size={13} className={`gen-chevron ${open ? 'is-open' : ''}`} />
            <span className="gen-section-title">{title}</span>
          </button>
        ) : (
          <span className="gen-section-title">{title}</span>
        )}
        {meta !== undefined && <span className="gen-section-meta">{meta}</span>}
        {action && <span className="gen-section-action">{action}</span>}
      </header>
      {expanded && <div className="gen-section-body">{children}</div>}
    </section>
  );
};
