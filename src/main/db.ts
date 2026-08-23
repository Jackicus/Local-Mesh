import Database from 'better-sqlite3';
import path from 'node:path';
import { app } from 'electron';
import type { Note } from '../core/types';

// Lazily opened on first use so the module can be imported before app.whenReady
let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(path.join(app.getPath('userData'), 'app.db'));
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      )
    `);
  }
  return db;
}

export function listNotes(): Note[] {
  return getDb()
    .prepare('SELECT id, text, created_at FROM notes ORDER BY id DESC')
    .all() as Note[];
}

export function addNote(text: string): Note {
  const info = getDb().prepare('INSERT INTO notes (text) VALUES (?)').run(text);
  return getDb()
    .prepare('SELECT id, text, created_at FROM notes WHERE id = ?')
    .get(info.lastInsertRowid) as Note;
}

export function deleteNote(id: number): boolean {
  return getDb().prepare('DELETE FROM notes WHERE id = ?').run(id).changes > 0;
}

export function closeDb() {
  db?.close();
  db = null;
}
