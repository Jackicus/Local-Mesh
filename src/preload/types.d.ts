import { ElectronAPI } from '../core/types';

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
