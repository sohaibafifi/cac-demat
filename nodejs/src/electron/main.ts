import type {
  OpenDialogOptions,
  BrowserWindow as ElectronBrowserWindow,
  MenuItemConstructorOptions,
  MessageBoxOptions,
} from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { createCoordinator } from '../app/coordinatorFactory.js';
import { DashboardCoordinator } from '../app/dashboardCoordinator.js';

type ElectronModule = typeof import('electron');

export default async function start(electron: ElectronModule): Promise<void> {
  const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = electron;

  let mainWindow: ElectronBrowserWindow | null = null;
  let coordinator: DashboardCoordinator | null = null;
  let advancedMode = false;

  const currentDir = path.dirname(fileURLToPath(import.meta.url));

  function requireCoordinator(): DashboardCoordinator {
    if (!coordinator) {
      throw new Error('Coordinator not initialised.');
    }

    return coordinator;
  }

  function serializeCoordinatorState(target: DashboardCoordinator) {
    return {
      folder: target.folder,
      csvReviewers: target.csvReviewers,
      csvMembers: target.csvMembers,
      availableFiles: [...target.availableFiles],
      reviewersFromCsv: target.reviewersFromCsv.map((entry) => ({
        file: entry.file,
        reviewers: [...entry.reviewers],
        source: entry.source,
      })),
      reviewersManual: target.reviewersManual.map((entry) => ({
        file: entry.file,
        reviewers: [...entry.reviewers],
        source: entry.source,
      })),
      membersFromCsv: target.membersFromCsv.map((entry) => ({
        name: entry.name,
        files: [...(entry.files ?? [])],
        source: entry.source,
      })),
      membersManual: target.membersManual.map((entry) => ({
        name: entry.name,
        files: [...(entry.files ?? [])],
        source: entry.source,
      })),
      fileEntries: target.fileEntries.map((entry) => ({ ...entry })),
      missingReviewerFiles: [...target.missingReviewerFiles],
      reviewerSummaries: target.getReviewerSummaries().map((summary) => ({
        name: summary.name,
        hasCsv: summary.hasCsv,
        hasManual: summary.hasManual,
        hasMissing: summary.hasMissing,
        files: summary.files.map((file) => ({
          name: file.name,
          missing: file.missing,
          manual: file.manual,
          manualIndex: file.manualIndex,
          source: file.source,
        })),
      })),
      combinedMembers: target.combinedMembers().map((entry) => ({
        name: entry.name,
        files: [...(entry.files ?? [])],
      })),
      log: target.log,
      status: target.status,
      running: target.running,
      cacName: target.cacName,
      canRunReviewers: target.getCanRunReviewers(),
      canRunMembers: target.getCanRunMembers(),
      lastReviewerOutputDir: target.lastReviewerOutputDir,
      lastMemberOutputDir: target.lastMemberOutputDir,
      lastRunMode: target.lastRunMode,
      lastRunStats: target.lastRunStats
        ? {
            runId: target.lastRunStats.runId,
            mode: target.lastRunStats.mode,
            requested: target.lastRunStats.requested,
            recipients: target.lastRunStats.recipients,
            files: target.lastRunStats.files,
            missing: target.lastRunStats.missing,
            outputDir: target.lastRunStats.outputDir,
          }
        : null,
    };
  }

  function broadcastAdvancedMode(enabled: boolean): void {
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send('view:advanced-mode', enabled);
    });
  }

  function setupApplicationMenu(): void {
    const isMac = process.platform === 'darwin';

    const viewSubmenu = [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { type: 'separator' },
      {
        label: 'Advanced',
        id: 'advanced-view-toggle',
        type: 'checkbox',
        checked: advancedMode,
        click: (menuItem) => {
          advancedMode = menuItem.checked;
          broadcastAdvancedMode(advancedMode);
        },
      },
    ] as MenuItemConstructorOptions[];

    const template: MenuItemConstructorOptions[] = [
      ...(isMac
        ? [
            {
              label: app.name,
              submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideothers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' },
              ] as MenuItemConstructorOptions[],
            },
          ]
        : []),
      {
        label: 'File',
        submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          ...(isMac
            ? [
                { role: 'pasteAndMatchStyle' },
                { role: 'delete' },
                { role: 'selectAll' },
              ]
            : [{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }]),
        ] as MenuItemConstructorOptions[],
      },
      {
        label: 'View',
        submenu: viewSubmenu,
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          ...(isMac
            ? [
                { type: 'separator' },
                { role: 'front' },
                { role: 'window' },
              ]
            : [{ role: 'close' }]),
        ] as MenuItemConstructorOptions[],
      },
      {
        role: 'help',
        submenu: [] as MenuItemConstructorOptions[],
      },
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  }

  function registerIpcHandlers(): void {
    ipcMain.handle('coordinator:init', async () => {
      if (!coordinator) {
        coordinator = createCoordinator();
      }

      return serializeCoordinatorState(requireCoordinator());
    });

    ipcMain.handle('coordinator:get-state', async () => serializeCoordinatorState(requireCoordinator()));

    ipcMain.handle('dialog:select-folder', async () => {
      const parent = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
      const options: OpenDialogOptions = {
        properties: ['openDirectory'],
      };
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options);

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      return result.filePaths[0];
    });

    ipcMain.handle('dialog:select-csv', async () => {
      const parent = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
      const options: OpenDialogOptions = {
        properties: ['openFile'],
        filters: [
          { name: 'CSV', extensions: ['csv'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      };
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options);

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      return result.filePaths[0];
    });

    ipcMain.handle('dialog:show-message', async (_event, options: MessageBoxOptions) => {
      const parent = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
      return parent
        ? dialog.showMessageBox(parent, options)
        : dialog.showMessageBox(options);
    });

    ipcMain.handle('coordinator:set-folder', async (_event, folder: string) => {
      const instance = requireCoordinator();
      await instance.setFolder(folder);
      return serializeCoordinatorState(instance);
    });

    ipcMain.handle('coordinator:set-reviewers-csv', async (_event, filePath: string) => {
      const instance = requireCoordinator();
      await instance.loadReviewersCsv(filePath);
      return serializeCoordinatorState(instance);
    });

    ipcMain.handle('coordinator:set-members-csv', async (_event, filePath: string) => {
      const instance = requireCoordinator();
      await instance.loadMembersCsv(filePath);
      return serializeCoordinatorState(instance);
    });

    ipcMain.handle('coordinator:set-cac-name', async (_event, cacName: string) => {
      const instance = requireCoordinator();
      instance.cacName = cacName;
      return serializeCoordinatorState(instance);
    });

    ipcMain.handle('coordinator:add-manual-reviewer', async (_event, payload: { file: string; reviewers: string }) => {
      const instance = requireCoordinator();
      instance.addManualReviewer(payload.file, payload.reviewers);
      return serializeCoordinatorState(instance);
    });

    ipcMain.handle('coordinator:remove-manual-reviewer', async (_event, index: number) => {
      const instance = requireCoordinator();
      instance.removeManualReviewer(index);
      return serializeCoordinatorState(instance);
    });

    ipcMain.handle('coordinator:add-manual-member', async (_event, payload: { name: string; files: string }) => {
      const instance = requireCoordinator();
      instance.addManualMember(payload.name, payload.files);
      return serializeCoordinatorState(instance);
    });

    ipcMain.handle('coordinator:remove-manual-member', async (_event, index: number) => {
      const instance = requireCoordinator();
      instance.removeManualMember(index);
      return serializeCoordinatorState(instance);
    });

    ipcMain.handle('coordinator:set-manual-member-files', async (_event, payload: { index: number; files: string[] }) => {
      const instance = requireCoordinator();
      instance.setManualMemberFiles(payload.index, payload.files);
      return serializeCoordinatorState(instance);
    });

    ipcMain.handle('coordinator:run', async (_event, mode: 'reviewers' | 'members') => {
      const instance = requireCoordinator();
      await instance.executeRun(mode);
      return serializeCoordinatorState(instance);
    });

    ipcMain.handle('coordinator:open-path', async (_event, filePath: string) => {
      const error = await shell.openPath(filePath);
      if (error) {
        throw new Error(error);
      }

      return true;
    });
    ipcMain.handle('view:get-advanced-mode', async () => advancedMode);
  }

  async function createWindow(): Promise<void> {
    coordinator = createCoordinator();

    mainWindow = new BrowserWindow({
      width: 1280,
      height: 860,
      minWidth: 960,
      minHeight: 720,
      title: 'CAC Demat (Node)',
      webPreferences: {
        // Use a CommonJS preload to satisfy Electron's require() loader
        preload: path.join(currentDir, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    const rendererHtml = path.join(currentDir, '..', 'renderer', 'index.html');
    await mainWindow.loadFile(rendererHtml);

    mainWindow.webContents.once('did-finish-load', () => {
      broadcastAdvancedMode(advancedMode);
    });

    mainWindow.on('closed', () => {
      mainWindow = null;
      coordinator = null;
    });
  }

  app.whenReady().then(async () => {
    registerIpcHandlers();
    setupApplicationMenu();
    await createWindow();

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
