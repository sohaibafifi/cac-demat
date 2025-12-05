import type {
  BrowserWindow as ElectronBrowserWindow,
} from 'electron';
import path from 'path';
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

  const autoUpdateManager = new AutoUpdateManager(
    app,
    dialog,
    BrowserWindow,
    () => mainWindow,
  );

  const currentDir = path.dirname(fileURLToPath(import.meta.url));

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
      {
        onCheckForUpdates: () => autoUpdateManager.manualCheck(),
      },
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
    registerIpcHandlers();
    setupApplicationMenu();
    await createWindow();
    autoUpdateManager.init();

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
