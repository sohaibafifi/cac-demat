import type {
  App,
  BrowserWindow as ElectronBrowserWindow,
  Dialog,
  MessageBoxOptions,
  MessageBoxReturnValue,
} from 'electron';
import updaterDefault, { type UpdateDownloadedEvent } from 'electron-updater';

const truthy = (value: string | undefined | null): boolean => {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

export class AutoUpdateManager {
  private readonly autoUpdater = updaterDefault.autoUpdater ?? updaterDefault;
  private readonly enabled: boolean;
  private checking = false;
  private manualCheckPending = false;

  constructor(
    private readonly app: App,
    private readonly dialog: Dialog,
    private readonly BrowserWindow: typeof ElectronBrowserWindow,
    private readonly getMainWindow: () => ElectronBrowserWindow | null,
  ) {
    this.enabled = this.computeEnabled();
  }

  init(): void {
    if (!this.enabled) {
      console.log('[auto-update] disabled (dev build or env override).');
      return;
    }

    this.autoUpdater.autoDownload = true;
    this.autoUpdater.autoInstallOnAppQuit = true;
    this.autoUpdater.logger = console;

    this.registerEventHandlers();

    setTimeout(() => {
      void this.checkForUpdates(false);
    }, 4000);
  }

  async manualCheck(): Promise<void> {
    if (!this.enabled) {
      await this.showInfoDialog('Mises a jour', 'Les mises a jour automatiques sont desactivees dans cet environnement.');
      return;
    }

    await this.checkForUpdates(true);
  }

  private computeEnabled(): boolean {
    if (!this.app.isPackaged) {
      return false;
    }

    const disableFlag =
      process.env.DISABLE_AUTO_UPDATER ??
      process.env.CAC_DEMAT_DISABLE_AUTOUPDATE ??
      process.env.CAC_DEMAT_DISABLE_AUTO_UPDATE;

    return !truthy(disableFlag);
  }

  private registerEventHandlers(): void {
    this.autoUpdater.on('checking-for-update', () => {
      console.log('[auto-update] checking for updates...');
    });

    this.autoUpdater.on('update-available', (info) => {
      console.log('[auto-update] update available:', info.version);
      this.checking = false;
      if (this.manualCheckPending) {
        void this.showInfoDialog('Mise a jour disponible', `La version ${info.version} est en cours de telechargement.`);
        this.manualCheckPending = false;
      }
    });

    this.autoUpdater.on('update-not-available', (info) => {
      console.log('[auto-update] no updates available (current version:', info.version, ')');
      this.checking = false;
      if (this.manualCheckPending) {
        void this.showInfoDialog('Aucune mise a jour', 'Vous disposez deja de la derniere version.');
        this.manualCheckPending = false;
      }
    });

    this.autoUpdater.on('update-downloaded', (event) => {
      console.log('[auto-update] update downloaded:', event.version);
      this.checking = false;
      this.manualCheckPending = false;
      void this.promptForInstall(event);
    });

    this.autoUpdater.on('error', (error) => {
      console.error('[auto-update] update error:', error);
      this.checking = false;
      if (this.manualCheckPending) {
        void this.showErrorDialog('Echec de la verification des mises a jour.', error);
        this.manualCheckPending = false;
      }
    });
  }

  private async checkForUpdates(isManual: boolean): Promise<void> {
    if (!this.enabled) {
      return;
    }

    if (this.checking) {
      if (isManual) {
        await this.showInfoDialog('Mises a jour', 'Une verification est deja en cours.');
      }
      return;
    }

    this.checking = true;
    this.manualCheckPending = isManual;

    try {
      await this.autoUpdater.checkForUpdates();
    } catch (error) {
      console.error('[auto-update] failed to check updates:', error);
      this.checking = false;
      if (isManual) {
        await this.showErrorDialog('Impossible de verifier les mises a jour.', error);
        this.manualCheckPending = false;
      }
    }
  }

  private async promptForInstall(event: UpdateDownloadedEvent): Promise<void> {
    const { response } = await this.showMessageBox({
      type: 'question',
      buttons: ['Redemarrer maintenant', 'Plus tard'],
      defaultId: 0,
      cancelId: 1,
      title: 'Mise a jour telechargee',
      message: `La version ${event.version} a ete telechargee.`,
      detail: 'Redemarrez maintenant pour appliquer la mise a jour.',
    });

    if (response === 0) {
      this.autoUpdater.quitAndInstall();
    }
  }

  private async showInfoDialog(title: string, message: string): Promise<void> {
    await this.showMessageBox({
      type: 'info',
      buttons: ['Fermer'],
      defaultId: 0,
      cancelId: 0,
      title,
      message,
    });
  }

  private async showErrorDialog(message: string, error: unknown): Promise<void> {
    const detail = error instanceof Error ? error.message : String(error);
    await this.showMessageBox({
      type: 'error',
      buttons: ['Fermer'],
      defaultId: 0,
      cancelId: 0,
      title: 'Mises a jour',
      message,
      detail,
    });
  }

  private async showMessageBox(options: MessageBoxOptions): Promise<MessageBoxReturnValue> {
    const parent = this.getDialogParent();
    if (parent) {
      return this.dialog.showMessageBox(parent, options);
    }
    return this.dialog.showMessageBox(options);
  }

  private getDialogParent(): ElectronBrowserWindow | undefined {
    return this.BrowserWindow.getFocusedWindow() ?? this.getMainWindow() ?? undefined;
  }
}
