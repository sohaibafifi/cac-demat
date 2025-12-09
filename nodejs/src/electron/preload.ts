import { createRequire } from 'module';
import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron';

const require = createRequire(import.meta.url);
const electron = require('electron') as typeof import('electron');
const { contextBridge, ipcRenderer } = electron;

const api = {
  init: () => ipcRenderer.invoke('coordinator:init') as Promise<any>,
  getState: () => ipcRenderer.invoke('coordinator:get-state') as Promise<any>,
  selectFolder: () => ipcRenderer.invoke('dialog:select-folder') as Promise<string | null>,
  selectCsv: () => ipcRenderer.invoke('dialog:select-csv') as Promise<string | null>,
  setFolder: (folder: string) => ipcRenderer.invoke('coordinator:set-folder', folder) as Promise<any>,
  setReviewersCsv: (filePath: string) => ipcRenderer.invoke('coordinator:set-reviewers-csv', filePath) as Promise<any>,
  setMembersCsv: (filePath: string) => ipcRenderer.invoke('coordinator:set-members-csv', filePath) as Promise<any>,
  clearReviewersCsv: () => ipcRenderer.invoke('coordinator:clear-reviewers-csv') as Promise<any>,
  clearMembersCsv: () => ipcRenderer.invoke('coordinator:clear-members-csv') as Promise<any>,
  setCacName: (name: string) => ipcRenderer.invoke('coordinator:set-cac-name', name) as Promise<any>,
  addManualReviewer: (payload: { file: string; reviewers: string }) =>
    ipcRenderer.invoke('coordinator:add-manual-reviewer', payload) as Promise<any>,
  removeManualReviewer: (index: number) =>
    ipcRenderer.invoke('coordinator:remove-manual-reviewer', index) as Promise<any>,
  addManualMember: (name: string, files: string) =>
    ipcRenderer.invoke('coordinator:add-manual-member', { name, files }) as Promise<any>,
  removeManualMember: (index: number) =>
    ipcRenderer.invoke('coordinator:remove-manual-member', index) as Promise<any>,
  setManualMemberFiles: (payload: { index: number; files: string[] }) =>
    ipcRenderer.invoke('coordinator:set-manual-member-files', payload) as Promise<any>,
  runPipeline: (mode: 'reviewers' | 'members') =>
    ipcRenderer.invoke('coordinator:run', mode) as Promise<any>,
  openPath: (filePath: string) => ipcRenderer.invoke('coordinator:open-path', filePath) as Promise<boolean>,
  getAdvancedMode: () => ipcRenderer.invoke('view:get-advanced-mode') as Promise<boolean>,
  getAppVersion: () => ipcRenderer.invoke('system:get-version') as Promise<string>,
  showMessageBox: (options: MessageBoxOptions) =>
    ipcRenderer.invoke('dialog:show-message', options) as Promise<MessageBoxReturnValue>,
  onAdvancedModeChange: (callback: (enabled: boolean) => void) => {
    const handler = (_event: unknown, enabled: boolean) => callback(Boolean(enabled));
    ipcRenderer.on('view:advanced-mode', handler);
    return () => {
      ipcRenderer.removeListener('view:advanced-mode', handler);
    };
  },
};

try {
  contextBridge.exposeInMainWorld('electronAPI', api);
} catch (error) {
  console.error('[preload] Failed to expose electronAPI', error);
}

export type ElectronApi = typeof api;

declare global {
  interface Window {
    electronAPI?: ElectronApi;
  }
}
