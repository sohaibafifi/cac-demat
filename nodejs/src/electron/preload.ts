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
  resetSession: () => ipcRenderer.invoke('coordinator:reset-session') as Promise<any>,
  setCacName: (name: string) => ipcRenderer.invoke('coordinator:set-cac-name', name) as Promise<any>,
  setCacType: (type: 'avancement' | 'ripec') => ipcRenderer.invoke('coordinator:set-cac-type', type) as Promise<any>,
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
  setZipReviewersEnabled: (enabled: boolean) => ipcRenderer.invoke('coordinator:set-zip-reviewers-enabled', enabled) as Promise<any>,
  setZipMembersEnabled: (enabled: boolean) => ipcRenderer.invoke('coordinator:set-zip-members-enabled', enabled) as Promise<any>,
  setPipelineStageEnabled: (payload: { mode: 'reviewers' | 'members'; stageId: string; enabled: boolean }) =>
    ipcRenderer.invoke('coordinator:set-stage-enabled', payload) as Promise<any>,
  setPdfRestrictionOptionEnabled: (payload: { mode: 'reviewers' | 'members'; optionId: string; enabled: boolean }) =>
    ipcRenderer.invoke('coordinator:set-restriction-option-enabled', payload) as Promise<any>,
  runPipeline: (mode: 'reviewers' | 'members') =>
    ipcRenderer.invoke('coordinator:run', mode) as Promise<any>,
  stopPipeline: () => ipcRenderer.invoke('coordinator:stop') as Promise<any>,
  generateReviewerDepositReport: (rootDir: string) =>
    ipcRenderer.invoke('reporting:generate-reviewer-deposits', rootDir) as Promise<any>,
  ownCloudGetConfig: () => ipcRenderer.invoke('owncloud:get-config') as Promise<any>,
  ownCloudSetConfig: (payload: any) => ipcRenderer.invoke('owncloud:set-config', payload) as Promise<any>,
  ownCloudTest: () => ipcRenderer.invoke('owncloud:test') as Promise<any>,
  ownCloudScanFolder: (folder: string) => ipcRenderer.invoke('owncloud:scan-folder', folder) as Promise<any>,
  ownCloudShareFolder: (payload: any) => ipcRenderer.invoke('owncloud:share-folder', payload) as Promise<any>,
  ownCloudCancel: () => ipcRenderer.invoke('owncloud:cancel') as Promise<boolean>,
  openPath: (filePath: string) => ipcRenderer.invoke('coordinator:open-path', filePath) as Promise<boolean>,
  getAdvancedMode: () => ipcRenderer.invoke('view:get-advanced-mode') as Promise<boolean>,
  getAppVersion: () => ipcRenderer.invoke('system:get-version') as Promise<string>,
  showMessageBox: (options: MessageBoxOptions) =>
    ipcRenderer.invoke('dialog:show-message', options) as Promise<MessageBoxReturnValue>,
  onCoordinatorUpdate: (callback: (state: any) => void) => {
    const handler = (_event: unknown, state: any) => callback(state);
    ipcRenderer.on('coordinator:update', handler);
    return () => {
      ipcRenderer.removeListener('coordinator:update', handler);
    };
  },
  onCoordinatorProgress: (callback: (progress: any) => void) => {
    const handler = (_event: unknown, progress: any) => callback(progress);
    ipcRenderer.on('coordinator:progress', handler);
    return () => {
      ipcRenderer.removeListener('coordinator:progress', handler);
    };
  },
  onAdvancedModeChange: (callback: (enabled: boolean) => void) => {
    const handler = (_event: unknown, enabled: boolean) => callback(Boolean(enabled));
    ipcRenderer.on('view:advanced-mode', handler);
    return () => {
      ipcRenderer.removeListener('view:advanced-mode', handler);
    };
  },
  onOwnCloudProgress: (callback: (progress: any) => void) => {
    const handler = (_event: unknown, progress: any) => callback(progress);
    ipcRenderer.on('owncloud:progress', handler);
    return () => {
      ipcRenderer.removeListener('owncloud:progress', handler);
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
