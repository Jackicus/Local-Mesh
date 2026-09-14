import React, { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon } from '../../assets/icons';

interface SetupLogProps {
  lines: string[];
}

/** Raw uv/pip output during environment setup; collapsed by default, follows the tail. */
export const SetupLog: React.FC<SetupLogProps> = ({ lines }) => {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = panelRef.current;
    if (open && el) el.scrollTop = el.scrollHeight;
  }, [lines, open]);

  return (
    <div className="models-setup-log">
      <button
        type="button"
        className={`models-setup-log-toggle ${open ? 'open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <ChevronDownIcon size={14} className="models-setup-log-chevron" />
        <span>Setup output</span>
        <span className="models-setup-log-count">{lines.length} lines</span>
      </button>
      {open && (
        <pre ref={panelRef} className="models-setup-log-panel">
          {lines.length === 0 ? 'Waiting for output…' : lines.join('\n')}
        </pre>
      )}
    </div>
  );
};
