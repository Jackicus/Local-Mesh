import React, { useEffect, useRef } from 'react';
import { Disclosure } from './Disclosure';

interface SetupLogProps {
  lines: string[];
}

/** Raw installer output. Collapsed by default; follows the tail while open. */
export const SetupLog: React.FC<SetupLogProps> = ({ lines }) => {
  const panelRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = panelRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <Disclosure summary="Installer output" meta={`${lines.length} lines`} className="models-log">
      <pre ref={panelRef} className="models-log-panel">
        {lines.length === 0 ? 'Waiting for output…' : lines.join('\n')}
      </pre>
    </Disclosure>
  );
};
