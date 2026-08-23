import { contextBridge, ipcRenderer } from 'electron';
import { ClaudeMdDir, ElectronAPI, IPC_CHANNELS } from '../core/types';

const electronAPI: ElectronAPI = {
  minimize: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MINIMIZE),
  maximize: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MAXIMIZE),
  close: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_CLOSE),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED),
  onMaximizedChange: (callback: (isMaximized: boolean) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, isMaximized: boolean) =>
      callback(isMaximized);
    ipcRenderer.on(IPC_CHANNELS.WINDOW_MAXIMIZED_CHANGE, subscription);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.WINDOW_MAXIMIZED_CHANGE, subscription);
    };
  },
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.APP_INFO),
  listNotes: () => ipcRenderer.invoke(IPC_CHANNELS.NOTES_LIST),
  addNote: (text: string) => ipcRenderer.invoke(IPC_CHANNELS.NOTES_ADD, text),
  deleteNote: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.NOTES_DELETE, id),
  readClaudeMd: (dir: ClaudeMdDir): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_MD_READ, dir),
  writeClaudeMd: (dir: ClaudeMdDir, content: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_MD_WRITE, dir, content),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
