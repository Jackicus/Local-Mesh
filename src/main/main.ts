import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CLAUDE_MD_DIRS, IPC_CHANNELS } from '../core/types';
import { listNotes, addNote, deleteNote, closeDb } from './db';
import { log, installCrashLogging } from './logger';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
const RENDERER_DIST = path.join(__dirname, '..', 'dist');

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized?: boolean;
}

const DEFAULT_STATE: WindowState = {
  width: 1000,
  height: 700,
  isMaximized: false,
};

function getWindowStatePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState(): WindowState {
  try {
    const data = fs.readFileSync(getWindowStatePath(), 'utf-8');
    const parsed = JSON.parse(data) as WindowState;

    // Validate that coordinates are visible within current displays
    if (parsed.x !== undefined && parsed.y !== undefined) {
      const visible = screen.getAllDisplays().some((display) => {
        const { x, y, width, height } = display.bounds;
        return (
          parsed.x! >= x &&
          parsed.x! < x + width &&
          parsed.y! >= y &&
          parsed.y! < y + height
        );
      });

      if (!visible) {
        return DEFAULT_STATE;
      }
    }

    return {
      width: Math.max(parsed.width || DEFAULT_STATE.width, 640),
      height: Math.max(parsed.height || DEFAULT_STATE.height, 480),
      x: parsed.x,
      y: parsed.y,
      isMaximized: parsed.isMaximized,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function saveWindowState(targetWin: BrowserWindow) {
  try {
    // A minimized window reports offscreen bounds (-32000 on Windows), which
    // would fail the visibility check on next launch and wipe the saved state
    if (targetWin.isMinimized()) return;

    const isMaximized = targetWin.isMaximized();
    // getNormalBounds() returns the restore geometry even while maximized
    const bounds = targetWin.getNormalBounds();

    const state: WindowState = {
      ...bounds,
      isMaximized,
    };

    fs.writeFileSync(getWindowStatePath(), JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save window state:', err);
  }
}

function registerIpcHandlers() {
  ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, (event) => {
    const targetWin = BrowserWindow.fromWebContents(event.sender);
    targetWin?.minimize();
  });

  ipcMain.on(IPC_CHANNELS.WINDOW_MAXIMIZE, (event) => {
    const targetWin = BrowserWindow.fromWebContents(event.sender);
    if (targetWin?.isMaximized()) {
      targetWin.unmaximize();
    } else {
      targetWin?.maximize();
    }
  });

  ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, (event) => {
    const targetWin = BrowserWindow.fromWebContents(event.sender);
    targetWin?.close();
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, (event) => {
    const targetWin = BrowserWindow.fromWebContents(event.sender);
    return targetWin?.isMaximized() ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.APP_INFO, () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
  }));

  // SQLite notes (src/main/db.ts) — inputs validated before touching the db
  ipcMain.handle(IPC_CHANNELS.NOTES_LIST, () => listNotes());

  ipcMain.handle(IPC_CHANNELS.NOTES_ADD, (_event, text: unknown) => {
    if (typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 500) return null;
    return addNote(trimmed);
  });

  ipcMain.handle(IPC_CHANNELS.NOTES_DELETE, (_event, id: unknown) => {
    if (typeof id !== 'number' || !Number.isInteger(id)) return false;
    return deleteNote(id);
  });
}

// Dev-only: lets the Developer view read/edit src/ui/*/CLAUDE.md. The dir key is
// validated against CLAUDE_MD_DIRS so the renderer can never address other paths.
function registerClaudeMdHandlers() {
  const claudeMdPath = (dir: string): string | null =>
    (CLAUDE_MD_DIRS as readonly string[]).includes(dir)
      ? path.join(app.getAppPath(), 'src', 'ui', dir, 'CLAUDE.md')
      : null;

  ipcMain.handle(IPC_CHANNELS.CLAUDE_MD_READ, (_event, dir: string) => {
    const filePath = claudeMdPath(dir);
    if (!filePath) return null;
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }
  });

  ipcMain.handle(IPC_CHANNELS.CLAUDE_MD_WRITE, (_event, dir: string, content: string) => {
    const filePath = claudeMdPath(dir);
    if (!filePath || typeof content !== 'string') return false;
    try {
      fs.writeFileSync(filePath, content, 'utf-8');
      return true;
    } catch (err) {
      console.error(`Failed to write ${filePath}:`, err);
      return false;
    }
  });
}

let win: BrowserWindow | null = null;

function createWindow() {
  const savedState = loadWindowState();

  win = new BrowserWindow({
    width: savedState.width,
    height: savedState.height,
    x: savedState.x,
    y: savedState.y,
    minWidth: 640,
    minHeight: 480,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#2a2a2a', // pre-paint color; keep close to --bg-app (dark) in variables.css
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (savedState.isMaximized) {
    win.maximize();
  }

  // Debounced window state persistence
  let saveTimeout: NodeJS.Timeout | null = null;
  const triggerSave = () => {
    if (!win) return;
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      if (win) saveWindowState(win);
    }, 400);
  };

  win.on('resize', triggerSave);
  win.on('move', triggerSave);
  win.on('close', () => {
    if (win) saveWindowState(win);
  });
  win.on('closed', () => {
    win = null;
  });

  win.on('maximize', () => {
    win?.webContents.send(IPC_CHANNELS.WINDOW_MAXIMIZED_CHANGE, true);
    triggerSave();
  });

  win.on('unmaximize', () => {
    win?.webContents.send(IPC_CHANNELS.WINDOW_MAXIMIZED_CHANGE, false);
    triggerSave();
  });

  // Intercept and securely open external links in user default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:') || url.startsWith('mailto:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win?.webContents.getURL()) {
      event.preventDefault();
      if (/^(https?|mailto):/.test(url)) {
        shell.openExternal(url);
      }
    }
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }
}

// Single instance: a second launch focuses the existing window instead
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('will-quit', () => {
  closeDb();
});

app.whenReady().then(() => {
  installCrashLogging();
  log.info(`app started v${app.getVersion()} (electron ${process.versions.electron})`);
  registerIpcHandlers();
  if (VITE_DEV_SERVER_URL) {
    registerClaudeMdHandlers();
  }
  createWindow();
});
