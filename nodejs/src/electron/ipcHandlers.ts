import type { IpcMain, IpcMainInvokeEvent, Dialog, Shell, OpenDialogOptions, MessageBoxOptions } from 'electron';
import { BrowserWindow } from 'electron';
import type { DashboardCoordinator, ProgressState } from '../app/dashboardCoordinator.js';
import { serializeCoordinatorState } from './coordinatorSerializer.js';

export class IpcHandlerRegistry {
  constructor(
    private readonly ipcMain: IpcMain,
    private readonly dialog: Dialog,
    private readonly shell: Shell,
    private readonly getCoordinator: () => DashboardCoordinator,
    private readonly getMainWindow: () => BrowserWindow | null,
    private readonly getAppVersion: () => string,
  ) {}
  private coordinatorUnsubscribe: (() => void) | null = null;
  private coordinatorProgressUnsubscribe: (() => void) | null = null;

  registerAll(): void {
    this.registerCoordinatorHandlers();
    this.registerDialogHandlers();
    this.registerSystemHandlers();
  }

  private registerCoordinatorHandlers(): void {
    this.subscribeToCoordinatorChanges();

    this.ipcMain.handle('coordinator:init', async () => {
      return serializeCoordinatorState(this.getCoordinator());
    });

    this.ipcMain.handle('coordinator:get-state', async () => {
      return serializeCoordinatorState(this.getCoordinator());
    });

    this.ipcMain.handle('coordinator:set-folder', async (_event: IpcMainInvokeEvent, folder: string) => {
      const coordinator = this.getCoordinator();
      await coordinator.setFolder(folder);
      return serializeCoordinatorState(coordinator);
    });

    this.ipcMain.handle('coordinator:set-reviewers-csv', async (_event: IpcMainInvokeEvent, filePath: string) => {
      const coordinator = this.getCoordinator();
      await coordinator.loadReviewersCsv(filePath);
      return serializeCoordinatorState(coordinator);
    });

    this.ipcMain.handle('coordinator:set-members-csv', async (_event: IpcMainInvokeEvent, filePath: string) => {
      const coordinator = this.getCoordinator();
      await coordinator.loadMembersCsv(filePath);
      return serializeCoordinatorState(coordinator);
    });

    this.ipcMain.handle('coordinator:clear-reviewers-csv', async () => {
      const coordinator = this.getCoordinator();
      coordinator.clearReviewersCsv();
      return serializeCoordinatorState(coordinator);
    });

    this.ipcMain.handle('coordinator:clear-members-csv', async () => {
      const coordinator = this.getCoordinator();
      coordinator.clearMembersCsv();
      return serializeCoordinatorState(coordinator);
    });

    this.ipcMain.handle('coordinator:set-cac-name', async (_event: IpcMainInvokeEvent, cacName: string) => {
      const coordinator = this.getCoordinator();
      coordinator.cacName = cacName;
      return serializeCoordinatorState(coordinator);
    });

    this.ipcMain.handle('coordinator:add-manual-reviewer', async (_event: IpcMainInvokeEvent, payload: { file: string; reviewers: string }) => {
      const coordinator = this.getCoordinator();
      coordinator.addManualReviewer(payload.file, payload.reviewers);
      return serializeCoordinatorState(coordinator);
    });

    this.ipcMain.handle('coordinator:remove-manual-reviewer', async (_event: IpcMainInvokeEvent, index: number) => {
      const coordinator = this.getCoordinator();
      coordinator.removeManualReviewer(index);
      return serializeCoordinatorState(coordinator);
    });

    this.ipcMain.handle('coordinator:add-manual-member', async (_event: IpcMainInvokeEvent, payload: { name: string; files: string }) => {
      const coordinator = this.getCoordinator();
      coordinator.addManualMember(payload.name, payload.files);
      return serializeCoordinatorState(coordinator);
    });

    this.ipcMain.handle('coordinator:remove-manual-member', async (_event: IpcMainInvokeEvent, index: number) => {
      const coordinator = this.getCoordinator();
      coordinator.removeManualMember(index);
      return serializeCoordinatorState(coordinator);
    });

    this.ipcMain.handle('coordinator:set-manual-member-files', async (_event: IpcMainInvokeEvent, payload: { index: number; files: string[] }) => {
      const coordinator = this.getCoordinator();
      coordinator.setManualMemberFiles(payload.index, payload.files);
      return serializeCoordinatorState(coordinator);
    });

    this.ipcMain.handle('coordinator:run', async (_event: IpcMainInvokeEvent, mode: 'reviewers' | 'members') => {
      const coordinator = this.getCoordinator();
      await coordinator.executeRun(mode);
      return serializeCoordinatorState(coordinator);
    });

    this.ipcMain.handle('coordinator:stop', async () => {
      const coordinator = this.getCoordinator();
      coordinator.requestStop();
      return serializeCoordinatorState(coordinator);
    });
  }

  private registerDialogHandlers(): void {
    this.ipcMain.handle('dialog:select-folder', async () => {
      const options: OpenDialogOptions = { properties: ['openDirectory'] };
      const result = await this.showDialog(options);
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
    });

    this.ipcMain.handle('dialog:select-csv', async () => {
      const options: OpenDialogOptions = {
        properties: ['openFile'],
        filters: [
          { name: 'Tableur (CSV / Excel)', extensions: ['csv', 'xls', 'xlsx'] },
          { name: 'Tous les fichiers', extensions: ['*'] },
        ],
      };
      const result = await this.showDialog(options);
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
    });

    this.ipcMain.handle('dialog:show-message', async (_event: IpcMainInvokeEvent, options: MessageBoxOptions) => {
      const parent = this.getFocusedOrMainWindow();
      return parent
        ? this.dialog.showMessageBox(parent, options)
        : this.dialog.showMessageBox(options);
    });
  }

  private registerSystemHandlers(): void {
    this.ipcMain.handle('coordinator:open-path', async (_event: IpcMainInvokeEvent, filePath: string) => {
      const error = await this.shell.openPath(filePath);
      if (error) {
        throw new Error(error);
      }
      return true;
    });

    this.ipcMain.handle('system:get-version', async () => {
      return this.getAppVersion();
    });
  }

  private async showDialog(options: OpenDialogOptions) {
    const parent = this.getFocusedOrMainWindow();
    return parent
      ? this.dialog.showOpenDialog(parent, options)
      : this.dialog.showOpenDialog(options);
  }

  private getFocusedOrMainWindow(): BrowserWindow | undefined {
    return BrowserWindow.getFocusedWindow() ?? this.getMainWindow() ?? undefined;
  }

  private subscribeToCoordinatorChanges(): void {
    if (this.coordinatorUnsubscribe) {
      this.coordinatorUnsubscribe();
      this.coordinatorUnsubscribe = null;
    }
    if (this.coordinatorProgressUnsubscribe) {
      this.coordinatorProgressUnsubscribe();
      this.coordinatorProgressUnsubscribe = null;
    }

    const coordinator = this.getCoordinator();
    const broadcast = (): void => this.broadcastCoordinatorState();
    this.coordinatorUnsubscribe = coordinator.onChange(broadcast);
    this.coordinatorProgressUnsubscribe = coordinator.onProgress((progress) =>
      this.broadcastCoordinatorProgress(progress),
    );
  }

  private broadcastCoordinatorState(): void {
    const window = this.getMainWindow();
    if (!window) {
      return;
    }

    try {
      window.webContents.send('coordinator:update', serializeCoordinatorState(this.getCoordinator()));
    } catch (error) {
      console.warn('[ipc] Unable to broadcast coordinator state', error);
    }
  }

  private broadcastCoordinatorProgress(progress: ProgressState): void {
    const window = this.getMainWindow();
    if (!window) {
      return;
    }

    try {
      window.webContents.send('coordinator:progress', progress);
    } catch (error) {
      console.warn('[ipc] Unable to broadcast coordinator progress', error);
    }
  }
}
