import React, { useEffect, useState } from 'react';
import { Card, Badge, Button, Form, toast } from '../../components';
import { DatabaseIcon, PlusIcon, CloseIcon } from '../../assets/icons';
import type { Note } from '../../../core/types';

/**
 * Minimal better-sqlite3 demo: rows live in userData/app.db, served over IPC
 * by src/main/db.ts. The pattern to copy for any persistent app data.
 */
export const NotesView: React.FC = () => {
  const api = window.electronAPI;
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    api?.listNotes().then(setNotes);
  }, []);

  const handleAdd = async () => {
    const text = draft.trim();
    if (!text || !api) return;
    const note = await api.addNote(text);
    if (note) {
      setNotes((prev) => [note, ...prev]);
      setDraft('');
    } else {
      toast.error('Note not saved — empty or over 500 characters.');
    }
  };

  const handleDelete = async (id: number) => {
    if (api && (await api.deleteNote(id))) {
      setNotes((prev) => prev.filter((n) => n.id !== id));
    }
  };

  return (
    <div className="view-container">
      <header className="view-header">
        <Badge variant="accent" icon={<DatabaseIcon size={14} />}>
          SQLite
        </Badge>
        <h1 className="view-title">Notes</h1>
        <p className="view-description">
          A minimal <code>better-sqlite3</code> demo — rows live in <code>userData/app.db</code>, served over IPC by <code>src/main/db.ts</code>.
        </p>
      </header>

      <Card
        title="Notes"
        subtitle="Stored on disk — restart the app and they're still here"
        icon={<DatabaseIcon size={20} />}
        action={<Badge variant="neutral">{notes.length}</Badge>}
      >
        {!api ? (
          <p className="setting-description">
            The Notes demo needs the Electron shell — IPC and SQLite aren't available in a plain browser tab.
          </p>
        ) : (
          <>
            <div className="note-composer">
              <Form.Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                placeholder="Write a note and press Enter..."
                maxLength={500}
                aria-label="New note"
              />
              <Button variant="primary" icon={<PlusIcon size={14} />} onClick={handleAdd} disabled={!draft.trim()}>
                Add
              </Button>
            </div>

            {notes.length === 0 ? (
              <p className="setting-description">No notes yet — add the first one above.</p>
            ) : (
              <div className="note-list">
                {notes.map((note) => (
                  <div key={note.id} className="note-row">
                    <span className="note-text">{note.text}</span>
                    <span className="note-date">{note.created_at}</span>
                    <Button
                      size="sm"
                      variant="subtle"
                      className="btn-icon-only"
                      icon={<CloseIcon size={14} />}
                      onClick={() => handleDelete(note.id)}
                      aria-label={`Delete note: ${note.text.slice(0, 40)}`}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
};
