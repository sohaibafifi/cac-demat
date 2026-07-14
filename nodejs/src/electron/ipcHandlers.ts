import type { IpcMain, IpcMainInvokeEvent, Dialog, Shell, OpenDialogOptions, MessageBoxOptions } from 'electron';
import { BrowserWindow, app, safeStorage } from 'electron';
import type { DashboardCoordinator, ProgressState } from '../app/dashboardCoordinator.js';
import { serializeCoordinatorState } from './coordinatorSerializer.js';
import { ReviewerDepositReportService } from '../services/reporting/reviewerDepositReportService.js';
import { OwnCloudShareService, type OwnCloudShareType } from '../services/sharing/ownCloudShareService.js';
import { OwnCloudConfigStore, type OwnCloudConfig } from '../services/sharing/ownCloudConfigStore.js';
import { SharingFolderScanner } from '../services/sharing/sharingFolderScanner.js';

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
  private readonly reviewerDepositReportService = new ReviewerDepositReportService();
  private readonly ownCloudShareService = new OwnCloudShareService();
  private readonly ownCloudConfigStore = new OwnCloudConfigStore(safeStorage, app.getPath('userData'));
  private readonly sharingFolderScanner = new SharingFolderScanner();
  private activeOwnCloudController: AbortController | null = null;

  registerAll(): void {
    this.registerCoordinatorHandlers();
    this.registerDialogHandlers();
    this.registerReportingHandlers();
    this.registerSharingHandlers();
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

    this.ipcMain.handle('coordinator:reset-session', async () => {
      const coordinator = this.getCoordinator();
      coordinator.resetSession();
      return serializeCoordinatorState(coordinator);
    });

    this.ipcMain.handle('coordinator:set-cac-name', async (_event: IpcMainInvokeEvent, cacName: string) => {
      const coordinator = this.getCoordinator();
      coordinator.cacName = cacName;
      return serializeCoordinatorState(coordinator);
    });

    this.ipcMain.handle('coordinator:set-cac-type', async (_event: IpcMainInvokeEvent, cacType: string) => {
      const coordinator = this.getCoordinator();
      coordinator.setCacType(cacType);
      return serializeCoordinatorState(coordinator);
    });

    this.ipcMain.handle('coordinator:set-zip-reviewers-enabled', async (_event: IpcMainInvokeEvent, enabled: boolean) => {
      const coordinator = this.getCoordinator();
      coordinator.setZipReviewersEnabled(Boolean(enabled));
      return serializeCoordinatorState(coordinator);
    });

    this.ipcMain.handle('coordinator:set-zip-members-enabled', async (_event: IpcMainInvokeEvent, enabled: boolean) => {
      const coordinator = this.getCoordinator();
      coordinator.setZipMembersEnabled(Boolean(enabled));
      return serializeCoordinatorState(coordinator);
    });

    this.ipcMain.handle(
      'coordinator:set-stage-enabled',
      async (
        _event: IpcMainInvokeEvent,
        payload: { mode: string; stageId: string; enabled: boolean },
      ) => {
        const coordinator = this.getCoordinator();
        coordinator.setPipelineStageEnabled(payload.mode, payload.stageId, Boolean(payload.enabled));
        return serializeCoordinatorState(coordinator);
      },
    );

    this.ipcMain.handle(
      'coordinator:set-restriction-option-enabled',
      async (
        _event: IpcMainInvokeEvent,
        payload: { mode: string; optionId: string; enabled: boolean },
      ) => {
        const coordinator = this.getCoordinator();
        coordinator.setPdfRestrictionOptionEnabled(payload.mode, payload.optionId, Boolean(payload.enabled));
        return serializeCoordinatorState(coordinator);
      },
    );

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

  private registerReportingHandlers(): void {
    this.ipcMain.handle('reporting:generate-reviewer-deposits', async (_event: IpcMainInvokeEvent, rootDir: string) => {
      return this.reviewerDepositReportService.generate(rootDir);
    });
  }

  private registerSharingHandlers(): void {
    this.ipcMain.handle('owncloud:get-config', async () => {
      return this.ownCloudConfigStore.describe();
    });

    this.ipcMain.handle('owncloud:set-config', async (_event: IpcMainInvokeEvent, payload: Partial<OwnCloudConfig> & { keepPassword?: boolean }) => {
      const current = await this.ownCloudConfigStore.load();
      const merged: OwnCloudConfig = {
        baseUrl: (payload.baseUrl ?? current.baseUrl).toString(),
        login: (payload.login ?? current.login).toString(),
        appPassword: payload.keepPassword ? current.appPassword : ((payload.appPassword ?? '').toString()),
        remoteRootPath: (payload.remoteRootPath ?? current.remoteRootPath).toString(),
        defaultPermissions: Number(payload.defaultPermissions ?? current.defaultPermissions) || 1,
        uploadByDefault: payload.uploadByDefault !== undefined ? Boolean(payload.uploadByDefault) : current.uploadByDefault,
        notifyByEmail: payload.notifyByEmail !== undefined ? Boolean(payload.notifyByEmail) : current.notifyByEmail,
      };
      await this.ownCloudConfigStore.save(merged);
      return this.ownCloudConfigStore.describe();
    });

    this.ipcMain.handle('owncloud:test', async () => {
      const config = await this.ownCloudConfigStore.load();
      this.assertCredentials(config);
      return this.ownCloudShareService.testConnection({
        baseUrl: config.baseUrl,
        login: config.login,
        appPassword: config.appPassword,
      });
    });

    this.ipcMain.handle('owncloud:scan-folder', async (_event: IpcMainInvokeEvent, folder: string) => {
      const recipients = await this.sharingFolderScanner.scan(folder);
      return { folder, recipients };
    });

    this.ipcMain.handle(
      'owncloud:share-folder',
      async (
        event: IpcMainInvokeEvent,
        payload: {
          recipientName: string;
          localPath: string;
          remotePath: string;
          shareWith: string;
          shareType: OwnCloudShareType;
          permissions?: number;
          expireDate?: string;
          sendNotification?: boolean;
          mode: 'share-only' | 'upload-and-share';
        },
      ) => {
        if (this.activeOwnCloudController) {
          throw new Error('Un transfert ownCloud est déjà en cours.');
        }
        const config = await this.ownCloudConfigStore.load();
        this.assertCredentials(config);
        const shareWith = payload.shareWith?.trim();
        if (!shareWith) {
          throw new Error('Login ou email du destinataire manquant.');
        }
        if (!['user', 'group', 'email'].includes(payload.shareType)) {
          throw new Error('Type de partage ownCloud invalide.');
        }
        if (payload.mode !== 'share-only' && payload.mode !== 'upload-and-share') {
          throw new Error('Mode de partage ownCloud invalide.');
        }
        const permissions = Number(payload.permissions ?? config.defaultPermissions);
        if (!Number.isInteger(permissions) || permissions < 1 || permissions > 31) {
          throw new Error('Permissions ownCloud invalides.');
        }
        const credentials = {
          baseUrl: config.baseUrl,
          login: config.login,
          appPassword: config.appPassword,
        };
        const remotePath = this.normalizeRemotePath(payload.remotePath);
        const controller = new AbortController();
        this.activeOwnCloudController = controller;

        try {
          let uploaded: { uploaded: number; total: number } | null = null;
          if (payload.mode === 'upload-and-share') {
            uploaded = await this.ownCloudShareService.uploadDirectory(
              credentials,
              payload.localPath,
              remotePath,
              (progress) => {
                event.sender.send('owncloud:progress', {
                  recipientName: payload.recipientName,
                  ...progress,
                });
              },
              controller.signal,
            );
          }

          const result = await this.ownCloudShareService.createShare(
            {
              ...credentials,
              remotePath,
              shareWith,
              shareType: payload.shareType,
              permissions,
              expireDate: payload.expireDate,
            },
            controller.signal,
          );

          const notification = {
            requested: Boolean(payload.sendNotification),
            sent: false,
            alreadySent: false,
            error: null as string | null,
          };
          if (notification.requested) {
            if (result.share.mailSent) {
              notification.alreadySent = true;
            } else {
              try {
                await this.ownCloudShareService.sendShareNotification(
                  credentials,
                  result.share,
                  controller.signal,
                );
                notification.sent = true;
              } catch (error) {
                notification.error = error instanceof Error
                  ? error.message
                  : 'La notification par e-mail a échoué.';
              }
            }
          }

          return {
            recipientName: payload.recipientName,
            remotePath,
            uploaded,
            share: result.share,
            alreadyExisted: result.alreadyExisted,
            notification,
          };
        } finally {
          if (this.activeOwnCloudController === controller) {
            this.activeOwnCloudController = null;
          }
        }
      },
    );

    this.ipcMain.handle('owncloud:cancel', async () => {
      const controller = this.activeOwnCloudController;
      if (!controller) {
        return false;
      }
      controller.abort();
      return true;
    });
  }

  private assertCredentials(config: { baseUrl: string; login: string; appPassword: string }): void {
    if (!config.baseUrl || !config.login || !config.appPassword) {
      throw new Error('Configuration ownCloud incomplète (URL, login, mot de passe applicatif).');
    }
  }

  private normalizeRemotePath(value: string): string {
    const trimmed = value.trim().replace(/\\/g, '/');
    const cleaned = trimmed.replace(/\/+/g, '/').replace(/\/+$/, '');
    if (!cleaned) {
      throw new Error('Chemin distant ownCloud non renseigné.');
    }
    const segments = cleaned.split('/').filter(Boolean);
    if (segments.some((segment) => segment === '.' || segment === '..' || segment.includes('\0'))) {
      throw new Error('Le chemin distant ownCloud contient un segment interdit.');
    }
    return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
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
