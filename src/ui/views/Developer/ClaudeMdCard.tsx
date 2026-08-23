import React, { useEffect, useState } from 'react';
import { Card, Badge, Button, toast } from '../../components';
import { FileTextIcon, EditIcon, CheckIcon } from '../../assets/icons';
import type { ClaudeMdDir } from '../../../core/types';

/**
 * Minimal markdown renderer covering what the CLAUDE.md files use:
 * #/##/### headings, - bullets, ``` fences, `code`, **bold**, [links](url).
 */
function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1] !== undefined) {
      parts.push(<code key={key++}>{match[1]}</code>);
    } else if (match[2] !== undefined) {
      parts.push(<strong key={key++}>{match[2]}</strong>);
    } else {
      parts.push(
        <a key={key++} href={match[4]}>
          {match[3]}
        </a>
      );
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function renderMarkdown(source: string): React.ReactNode {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  let paragraph: string[] = [];
  let codeLines: string[] | null = null;
  let key = 0;

  const flushList = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={key++}>
        {list.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>
    );
    list = [];
  };
  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(<p key={key++}>{renderInline(paragraph.join(' '))}</p>);
    paragraph = [];
  };

  for (const line of source.split('\n')) {
    if (codeLines !== null) {
      if (line.startsWith('```')) {
        blocks.push(
          <pre key={key++}>
            <code>{codeLines.join('\n')}</code>
          </pre>
        );
        codeLines = null;
      } else {
        codeLines.push(line);
      }
      continue;
    }
    if (line.startsWith('```')) {
      flushList();
      flushParagraph();
      codeLines = [];
      continue;
    }
    const heading = /^(#{1,3}) (.*)$/.exec(line);
    if (heading) {
      flushList();
      flushParagraph();
      const Tag = `h${heading[1].length}` as 'h1' | 'h2' | 'h3';
      blocks.push(<Tag key={key++}>{renderInline(heading[2])}</Tag>);
      continue;
    }
    if (/^[-*] /.test(line)) {
      flushParagraph();
      list.push(line.slice(2));
      continue;
    }
    if (line.trim() === '') {
      flushList();
      flushParagraph();
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushList();
  flushParagraph();
  return blocks;
}

interface ClaudeMdCardProps {
  dir: ClaudeMdDir;
}

/**
 * Renders a directory's CLAUDE.md from disk with in-place editing, saved back
 * over IPC. Dev only: the main process registers the handlers only under the
 * dev server, and the card hides itself in production or plain-browser preview.
 */
export const ClaudeMdCard: React.FC<ClaudeMdCardProps> = ({ dir }) => {
  const api = window.electronAPI;
  const available = import.meta.env.DEV && Boolean(api?.readClaudeMd);

  const [content, setContent] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!available) return;
    let isMounted = true;
    api!.readClaudeMd(dir).then((text) => {
      if (isMounted) setContent(text);
    });
    return () => {
      isMounted = false;
    };
  }, [dir, available]);

  if (!available) return null;

  const handleSave = async () => {
    setSaving(true);
    const ok = await api!.writeClaudeMd(dir, draft);
    setSaving(false);
    if (ok) {
      setContent(draft);
      setEditing(false);
      toast.success(`Saved src/ui/${dir}/CLAUDE.md`);
    } else {
      toast.error(`Could not save ${dir}/CLAUDE.md — see the main process console.`);
    }
  };

  return (
    <Card
      title={`${dir}/CLAUDE.md`}
      subtitle="Directory conventions — edits save straight to disk"
      icon={<FileTextIcon size={20} />}
      action={
        editing ? (
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button size="sm" variant="subtle" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<CheckIcon size={14} />}
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Badge variant="neutral">dev only</Badge>
            <Button
              size="sm"
              variant="secondary"
              icon={<EditIcon size={14} />}
              onClick={() => {
                setDraft(content ?? '');
                setEditing(true);
              }}
            >
              Edit
            </Button>
          </div>
        )
      }
    >
      {editing ? (
        <textarea
          className="claude-md-editor"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
        />
      ) : content === null ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.929rem' }}>
          No CLAUDE.md found in src/ui/{dir}/ — hit Edit to create one.
        </p>
      ) : (
        <div className="claude-md">{renderMarkdown(content)}</div>
      )}
    </Card>
  );
};
