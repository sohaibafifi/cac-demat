// CommonJS preload to avoid ESM require() issues in Electron
const { contextBridge, ipcRenderer } = require('electron');

const api = {
  init: () => ipcRenderer.invoke('coordinator:init'),
  getState: () => ipcRenderer.invoke('coordinator:get-state'),
  selectFolder: () => ipcRenderer.invoke('dialog:select-folder'),
  selectCsv: () => ipcRenderer.invoke('dialog:select-csv'),
  setFolder: (folder) => ipcRenderer.invoke('coordinator:set-folder', folder),
  setReviewersCsv: (filePath) => ipcRenderer.invoke('coordinator:set-reviewers-csv', filePath),
  setMembersCsv: (filePath) => ipcRenderer.invoke('coordinator:set-members-csv', filePath),
  clearReviewersCsv: () => ipcRenderer.invoke('coordinator:clear-reviewers-csv'),
  clearMembersCsv: () => ipcRenderer.invoke('coordinator:clear-members-csv'),
  setCacName: (name) => ipcRenderer.invoke('coordinator:set-cac-name', name),
  addManualReviewer: (payload) => ipcRenderer.invoke('coordinator:add-manual-reviewer', payload),
  removeManualReviewer: (index) => ipcRenderer.invoke('coordinator:remove-manual-reviewer', index),
  addManualMember: (name, files) => ipcRenderer.invoke('coordinator:add-manual-member', { name, files }),
  removeManualMember: (index) => ipcRenderer.invoke('coordinator:remove-manual-member', index),
  setManualMemberFiles: (payload) => ipcRenderer.invoke('coordinator:set-manual-member-files', payload),
  runPipeline: (mode) => ipcRenderer.invoke('coordinator:run', mode),
  openPath: (filePath) => ipcRenderer.invoke('coordinator:open-path', filePath),
  getAdvancedMode: () => ipcRenderer.invoke('view:get-advanced-mode'),
  getAppVersion: () => ipcRenderer.invoke('system:get-version'),
  showMessageBox: (options) => ipcRenderer.invoke('dialog:show-message', options),
  onCoordinatorUpdate: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('coordinator:update', handler);
    return () => {
      ipcRenderer.removeListener('coordinator:update', handler);
    };
  },
  onCoordinatorProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on('coordinator:progress', handler);
    return () => {
      ipcRenderer.removeListener('coordinator:progress', handler);
    };
  },
  onAdvancedModeChange: (callback) => {
    const handler = (_event, enabled) => callback(Boolean(enabled));
    ipcRenderer.on('view:advanced-mode', handler);
    return () => {
      ipcRenderer.removeListener('view:advanced-mode', handler);
    };
  },
};

try {
  contextBridge.exposeInMainWorld('electronAPI', api);
  // eslint-disable-next-line no-console
  console.log('[preload.cjs] electronAPI exposed');
} catch (error) {
  // eslint-disable-next-line no-console
  console.error('[preload.cjs] Failed to expose electronAPI', error);
}
