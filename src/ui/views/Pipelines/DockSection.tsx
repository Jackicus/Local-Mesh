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
 * One band of the pipelines dock. Deliberately a local copy of the Generate
 * view's section rather than a shared import: the two docks look alike today
 * but the views are meant to stay independent of each other.
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
    <section className="pipe-section">
      <header className="pipe-section-head">
        {collapsible ? (
          <button type="button" className="pipe-section-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <ChevronDownIcon size={13} className={`pipe-chevron ${open ? 'is-open' : ''}`} />
            <span className="pipe-section-title">{title}</span>
          </button>
        ) : (
          <span className="pipe-section-title">{title}</span>
        )}
        {meta !== undefined && <span className="pipe-section-meta">{meta}</span>}
        {action && <span className="pipe-section-action">{action}</span>}
      </header>
      {expanded && <div className="pipe-section-body">{children}</div>}
    </section>
  );
};
