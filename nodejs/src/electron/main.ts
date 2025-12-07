import type { BrowserWindow as ElectronBrowserWindow } from 'electron';
import path from 'path';
import Module from 'module';
import { fileURLToPath } from 'url';
import { createCoordinator } from '../app/coordinatorFactory.js';
import { DashboardCoordinator } from '../app/dashboardCoordinator.js';
import { IpcHandlerRegistry } from './ipcHandlers.js';
import { ApplicationMenuBuilder } from './applicationMenu.js';
import { AutoUpdateManager } from './autoUpdateManager.js';

type ElectronModule = typeof import('electron');

export default async function start(electron: ElectronModule): Promise<void> {
  const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = electron;

  let mainWindow: ElectronBrowserWindow | null = null;
  let coordinator: DashboardCoordinator | null = null;
  let advancedMode = false;

  const isAutoUpdateEnabled = true;
  const autoUpdateManager = isAutoUpdateEnabled
    ? new AutoUpdateManager(
        app,
        dialog,
        BrowserWindow,
        () => mainWindow,
      )
    : null;

  const currentDir = path.dirname(fileURLToPath(import.meta.url));

  function extendNodePath(): void {
    try {
      const appPath = app.getAppPath();
      const rootNodeModules = path.join(appPath, 'node_modules');
      const distNodeModules = path.join(appPath, 'dist', 'node_modules');

      const existing = process.env.NODE_PATH ?? '';
      const paths = existing.split(path.delimiter).filter((entry) => entry);
      
      // Add both root and dist node_modules
      [rootNodeModules, distNodeModules].forEach((modulePath) => {
        if (modulePath && !paths.includes(modulePath)) {
          paths.unshift(modulePath);
        }
      });

      process.env.NODE_PATH = paths.join(path.delimiter);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Module as any)._initPaths?.();
    } catch (error) {
      console.warn('[bootstrap] Unable to extend NODE_PATH', error);
    }
  }

  function getCoordinator(): DashboardCoordinator {
    if (!coordinator) {
      coordinator = createCoordinator();
    }
    return coordinator;
  }

  function broadcastAdvancedMode(enabled: boolean): void {
    BrowserWindow.getAllWindows().forEach((window: ElectronBrowserWindow) => {
      window.webContents.send('view:advanced-mode', enabled);
    });
  }

  function setupApplicationMenu(): void {
    const menuBuilder = new ApplicationMenuBuilder(
      Menu,
      app.name,
      process.platform === 'darwin',
      autoUpdateManager
        ? {
            onCheckForUpdates: () => autoUpdateManager.manualCheck(),
          }
        : {},
    );

    const handleAdvancedModeToggle = (checked: boolean) => {
      advancedMode = checked;
      broadcastAdvancedMode(advancedMode);
    };

    const menu = menuBuilder.build(advancedMode, handleAdvancedModeToggle);
    Menu.setApplicationMenu(menu);
  }

  function registerIpcHandlers(): void {
    const registry = new IpcHandlerRegistry(
      ipcMain,
      dialog,
      shell,
      getCoordinator,
      () => mainWindow,
      () => app.getVersion(),
    );
    registry.registerAll();

    // Register view handlers
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
    extendNodePath();
    registerIpcHandlers();
    setupApplicationMenu();
    await createWindow();
    if (autoUpdateManager) {
      autoUpdateManager.init();
    }

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
