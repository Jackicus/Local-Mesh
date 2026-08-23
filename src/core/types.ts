export interface Note {
  id: number;
  text: string;
  created_at: string;
}

export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
}

export interface ElectronAPI {
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  onMaximizedChange: (callback: (isMaximized: boolean) => void) => () => void;
  getAppInfo: () => Promise<AppInfo>;
  listNotes: () => Promise<Note[]>;
  addNote: (text: string) => Promise<Note | null>;
  deleteNote: (id: number) => Promise<boolean>;
  readClaudeMd: (dir: ClaudeMdDir) => Promise<string | null>;
  writeClaudeMd: (dir: ClaudeMdDir, content: string) => Promise<boolean>;
}

// src/ui directories whose CLAUDE.md the Developer view can read/write (dev only).
// The main process validates against this list so the renderer can never name a path.
export const CLAUDE_MD_DIRS = [
  'assets',
  'components',
  'hooks',
  'shell',
  'stores',
  'views',
] as const;

export type ClaudeMdDir = (typeof CLAUDE_MD_DIRS)[number];

export const IPC_CHANNELS = {
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:isMaximized',
  WINDOW_MAXIMIZED_CHANGE: 'window:maximized-change',
  APP_INFO: 'app:info',
  NOTES_LIST: 'db:notes-list',
  NOTES_ADD: 'db:notes-add',
  NOTES_DELETE: 'db:notes-delete',
  CLAUDE_MD_READ: 'claudemd:read',
  CLAUDE_MD_WRITE: 'claudemd:write',
} as const;
