import type { BrowserWindow as ElectronBrowserWindow } from 'electron';
import path from 'path';
import Module from 'module';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';
import { createCoordinator } from '../app/coordinatorFactory.js';
import { DashboardCoordinator } from '../app/dashboardCoordinator.js';
import { IpcHandlerRegistry } from './ipcHandlers.js';
import { ApplicationMenuBuilder } from './applicationMenu.js';
import { AutoUpdateManager } from './autoUpdateManager.js';

type ElectronModule = typeof import('electron');

/**
 * Convert markdown to HTML with basic styling
 */
function convertMarkdownToHtml(markdown: string): string {
  let html = markdown
    // Headers (order matters - h4 before h3, etc.)
    .replace(/^#### (.*$)/gim, '<h4>$1</h4>')
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Code blocks
    .replace(/```([a-z]*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Tables - simple markdown table conversion
    .replace(/\|(.+)\|\n\|[-:\s|]+\|\n((?:\|.+\|\n?)*)/g, (match, header, rows) => {
      const headerCells = header.split('|').filter((c: string) => c.trim()).map((c: string) => `<th>${c.trim()}</th>`).join('');
      const bodyRows = rows.trim().split('\n').map((row: string) => {
        const cells = row.split('|').filter((c: string) => c.trim()).map((c: string) => `<td>${c.trim()}</td>`).join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      return `<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
    })
    // Lists
    .replace(/^\* (.+)$/gim, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    // Line breaks
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Guide d'import des fichiers</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 850px;
      margin: 0 auto;
      padding: 2rem;
      background: #f9fafb;
    }
    h1 {
      color: #1f2937;
      border-bottom: 3px solid #2563eb;
      padding-bottom: 0.5rem;
      margin-top: 2rem;
    }
    h2 {
      color: #374151;
      margin-top: 2rem;
      border-bottom: 2px solid #e5e7eb;
      padding-bottom: 0.3rem;
    }
    h3 {
      color: #4b5563;
      margin-top: 1.5rem;
    }
    h4 {
      color: #6b7280;
      margin-top: 1.25rem;
      font-size: 1.1em;
    }
    code {
      background: #f3f4f6;
      padding: 0.2rem 0.4rem;
      border-radius: 3px;
      font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
      font-size: 0.9em;
      color: #dc2626;
    }
    pre {
      background: #1f2937;
      color: #f9fafb;
      padding: 1rem;
      border-radius: 6px;
      overflow-x: auto;
      margin: 1rem 0;
    }
    pre code {
      background: transparent;
      color: inherit;
      padding: 0;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1rem 0;
      background: white;
      border-radius: 6px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    th, td {
      padding: 0.75rem;
      text-align: left;
      border: 1px solid #e5e7eb;
    }
    th {
      background: #f3f4f6;
      font-weight: 600;
      color: #1f2937;
    }
    tr:hover {
      background: #f9fafb;
    }
    ul {
      margin: 0.5rem 0;
      padding-left: 2rem;
    }
    li {
      margin: 0.5rem 0;
    }
    p {
      margin: 1rem 0;
    }
    strong {
      color: #1f2937;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <p>${html}</p>
</body>
</html>`;
}

export default async function start(electron: ElectronModule): Promise<void> {
  const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = electron;

  let mainWindow: ElectronBrowserWindow | null = null;
  let aboutWindow: ElectronBrowserWindow | null = null;
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

  function getIconPath(): string | undefined {
    const fileName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
    const candidates = [
      // Built assets copied to dist during build
      path.join(currentDir, '..', 'assets', fileName),
      // Packaged app resources
      path.join(process.resourcesPath ?? '', 'dist', 'assets', fileName),
      // Fallback to local build directory when running unpackaged
      path.join(currentDir, '..', '..', 'build', fileName),
      // Final fallback to NativePHP public icon if present
      path.join(currentDir, '..', '..', '..', 'nativephp', 'public', 'icon.png'),
    ];

    for (const candidate of candidates) {
      if (candidate && existsSync(candidate)) {
        return candidate;
      }
    }
    return undefined;
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

  function showAboutWindow(): void {
    if (aboutWindow) {
      aboutWindow.focus();
      return;
    }

    const appName = app.name || 'CAC Demat';
    const version = app.getVersion();
    const iconPath = getIconPath();

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>À propos</title>
  <style>
    body { margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', sans-serif; background: #0b1221; color: #e5e7eb; }
    .card { background: radial-gradient(circle at 20% 20%, rgba(255,255,255,0.04), transparent 25%), radial-gradient(circle at 80% 0%, rgba(37,99,235,0.15), transparent 35%), #0f172a; border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 18px; box-shadow: 0 8px 30px rgba(0,0,0,0.35); }
    h1 { margin: 0 0 8px 0; font-size: 20px; letter-spacing: 0.4px; color: #f8fafc; }
    .version { color: #93c5fd; margin: 0 0 12px 0; font-weight: 600; }
    .meta { color: #cbd5e1; margin: 0 0 12px 0; line-height: 1.5; }
    .details { display: grid; gap: 6px; margin-top: 12px; color: #e2e8f0; }
    .details span { color: #94a3b8; margin-right: 6px; }
    .footer { margin-top: 14px; color: #cbd5e1; font-size: 13px; }
    a { color: #93c5fd; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${appName}</h1>
    <p class="version">Version ${version}</p>
    <p class="meta">Application desktop pour préparer des packages PDF pour les rapporteurs et les membres.</p>
    <div class="details">
      <div><span>Plateforme :</span> ${process.platform}</div>
      <div><span>Electron :</span> ${process.versions.electron}</div>
      <div><span>Node :</span> ${process.versions.node}</div>
    </div>
    <p class="footer">Université d'Artois — <a href="https://www.univ-artois.fr">www.univ-artois.fr</a></p>
  </div>
</body>
</html>`;

    aboutWindow = new BrowserWindow({
      width: 420,
      height: 360,
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: `À propos de ${appName}`,
      autoHideMenuBar: true,
      show: false,
      ...(iconPath ? { icon: iconPath } : {}),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    aboutWindow.on('closed', () => {
      aboutWindow = null;
    });

    void aboutWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
    aboutWindow.once('ready-to-show', () => {
      aboutWindow?.show();
    });
  }

  function setupApplicationMenu(): void {
    const menuOptions = autoUpdateManager
      ? {
          onCheckForUpdates: () => autoUpdateManager.manualCheck(),
          onShowImportHelp: () => {
            try {
              // Read the documentation markdown file
              const docPath = app.isPackaged
                ? path.join(process.resourcesPath, 'docs/FORMAT_IMPORT.md')
                : path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/FORMAT_IMPORT.md');
              
              const markdownContent = readFileSync(docPath, 'utf-8');
              
              // Create a new window to display the help
              const helpWindow = new BrowserWindow({
                width: 900,
                height: 700,
                title: 'Guide d\'import des fichiers',
                parent: mainWindow ?? undefined,
                modal: false,
                webPreferences: {
                  nodeIntegration: false,
                  contextIsolation: true,
                },
              });

              // Convert markdown to HTML with basic styling
              const htmlContent = convertMarkdownToHtml(markdownContent);
              helpWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
              
              helpWindow.removeMenu();
            } catch (err) {
              console.error('Failed to open documentation:', err);
              dialog.showErrorBox(
                'Erreur',
                'Impossible d\'ouvrir le guide d\'import. Veuillez vérifier que le fichier existe.'
              );
            }
          },
          onShowAbout: () => showAboutWindow(),
        }
      : {
          onShowAbout: () => showAboutWindow(),
        };

    const menuBuilder = new ApplicationMenuBuilder(
      Menu,
      app.name,
      process.platform === 'darwin',
      menuOptions,
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

    const windowIcon = getIconPath();

    mainWindow = new BrowserWindow({
      width: 1280,
      height: 860,
      minWidth: 960,
      minHeight: 720,
      title: 'CAC Demat (Node)',
      ...(windowIcon ? { icon: windowIcon } : {}),
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

    const appIcon = getIconPath();
    if (process.platform === 'darwin' && appIcon && app.dock) {
      app.dock.setIcon(appIcon);
    }

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
