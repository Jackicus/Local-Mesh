import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CLAUDE_MD_DIRS, IPC_CHANNELS } from '../core/types';
import { killEnvChildren } from './envManager';
import { since } from './format';
import { registerAllHandlers } from './ipc';
import { loadJobs } from './jobStore';
import { initLogger, installCrashLogging, log } from './logger';
import { migrateSplitWeights } from './migrateWeights';
import { killDownloadChildren } from './modelManager';
import { ensureTree, getPaths } from './paths';
import { ensureDefaultPipeline } from './pipelines';
import { defaultModelId, shutdownQueue } from './queue';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
const RENDERER_DIST = path.join(__dirname, '..', 'dist');

// Linux has no icon embedded in the executable the way Windows/macOS do — the
// taskbar and alt-tab fall back to a generic placeholder unless BrowserWindow
// is handed one. Lives outside dist/ so dev and production resolve it alike.
const APP_ICON = path.join(__dirname, '..', 'resources', 'icon.png');

if (process.platform === 'linux') {
  // Run natively on Wayland where it's available, X11/XWayland otherwise.
  // Without the hint, Electron's default varies by version and distro build.
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');

  // productName is "Local Mesh"; XDG dirs conventionally avoid spaces and caps,
  // so pin the config dir rather than inheriting ~/.config/Local Mesh.
  app.setPath('userData', path.join(app.getPath('appData'), 'local-mesh'));
}

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
    // Debug, not warn: the window simply reopens at its default size, and this
    // fires on every resize, so a failing disk would flood the log.
    log.general.debug(`could not save window-state.json: ${err instanceof Error ? err.message : String(err)}`);
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
      log.general.error(
        `could not write src/ui/${dir}/CLAUDE.md: ${err instanceof Error ? err.message : String(err)}`
      );
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
    // Labels the window in the taskbar/alt-tab before the renderer's <title>
    // lands — visible on Linux, where there is no titlebar to hide it.
    title: 'Local Mesh',
    frame: false,
    titleBarStyle: 'hidden',
    ...(process.platform === 'linux' ? { icon: APP_ICON } : {}),
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

  // A renderer that fails to load or dies leaves a blank window and no other
  // trace; these three listeners are the only record of it.
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    // -3 is ERR_ABORTED, which every cancelled in-page navigation reports.
    if (code === -3) return;
    log.general.error(`renderer failed to load ${url || '(no url)'}: ${description} (${code})`);
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    log.general.error(
      `renderer process gone: ${details.reason}${details.exitCode ? ` (exit ${details.exitCode})` : ''}`
    );
  });

  win.on('unresponsive', () => {
    log.general.warn('the window stopped responding');
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
const isPrimaryInstance = app.requestSingleInstanceLock();

if (!isPrimaryInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) {
      createWindow();
      return;
    }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
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

// Quitting has to wait for the python worker to stop, so the first `before-quit`
// is deferred and re-issued once shutdown has run (or timed out).
const SHUTDOWN_TIMEOUT_MS = 8000;
let shutdown: Promise<void> | null = null;
let quitRequested = false;
let readyToQuit = false;

/**
 * Stop the worker and anything else in flight. Idempotent: every caller gets
 * the same promise, so a `before-quit` that races a signal (or a signal that
 * arrives twice) never starts a second teardown.
 */
function beginShutdown(): Promise<void> {
  if (shutdown) return shutdown;
  const startedAt = Date.now();
  log.general.info('shutting down: stopping the worker and any setup or download in flight');
  killEnvChildren();
  killDownloadChildren();
  shutdown = new Promise<void>((resolve) => {
    const guard = setTimeout(() => {
      log.general.warn(`shutdown did not finish within ${SHUTDOWN_TIMEOUT_MS / 1000}s; quitting anyway`);
      resolve();
    }, SHUTDOWN_TIMEOUT_MS);
    shutdownQueue().finally(() => {
      clearTimeout(guard);
      log.general.info(`shutdown complete in ${since(startedAt)}`);
      resolve();
    });
  });
  return shutdown;
}

function shutdownThenQuit(): void {
  if (quitRequested) return;
  quitRequested = true;
  void beginShutdown().then(() => {
    readyToQuit = true;
    app.quit();
  });
}

app.on('before-quit', (event) => {
  if (readyToQuit) return;
  event.preventDefault();
  shutdownThenQuit();
});

/**
 * Ctrl-C in `npm run dev` (and a `kill` from a supervisor) never reaches
 * `before-quit`, so without this the python worker is orphaned. Same path as a
 * normal quit; a second signal while it runs is ignored, and a third gives up
 * and exits hard.
 */
function installSignalHandlers(): void {
  let signalled = 0;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      signalled += 1;
      if (signalled > 2) {
        log.general.warn(`${signal} again; exiting immediately`);
        app.exit(1);
        return;
      }
      log.general.info(`received ${signal}; shutting down`);
      shutdownThenQuit();
    });
  }
}

app.whenReady().then(() => {
  // `app.quit()` on a losing second instance is asynchronous, so `ready` can
  // still fire in that process. Without this guard it would create a window,
  // start a logger and touch ~/.local-mesh on its way out.
  if (!isPrimaryInstance) return;
  ensureTree();
  initLogger(getPaths().logs);
  installCrashLogging();
  // The one line that has to be complete: every bug report starts here.
  log.general.info(
    `local mesh ${app.getVersion()} started — electron ${process.versions.electron}, node ${process.versions.node}, ` +
      `${process.platform} ${process.arch}, root ${getPaths().root}`
  );
  // Before anything reads an install state: rescue weights a registry split
  // left in the wrong folder, so a model that is already on disk is not
  // offered as a fresh download.
  migrateSplitWeights();
  // The job list outlives the process: a finished job holds a mesh the user has
  // not saved or thrown away yet. Read it back before any window can ask for
  // the queue, and before the first broadcast overwrites the file with nothing.
  try {
    loadJobs(defaultModelId());
  } catch (err) {
    log.general.error(
      `the saved job queue could not be read: ${err instanceof Error ? err.message : String(err)}. ` +
        'Starting with an empty queue.'
    );
  }
  try {
    ensureDefaultPipeline();
  } catch (err) {
    log.general.error(
      `could not create the default pipeline: ${err instanceof Error ? err.message : String(err)}. ` +
        'Create one in the Pipelines view before generating.'
    );
  }
  installSignalHandlers();
  registerIpcHandlers();
  registerAllHandlers();
  if (VITE_DEV_SERVER_URL) {
    registerClaudeMdHandlers();
  }
  createWindow();
});
