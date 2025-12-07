import type {
  App,
  BrowserWindow as ElectronBrowserWindow,
  Dialog,
  MessageBoxOptions,
  MessageBoxReturnValue,
} from 'electron';

export class AutoUpdateManager {
  constructor(
    private readonly app: App,
    private readonly dialog: Dialog,
    private readonly BrowserWindow: typeof ElectronBrowserWindow,
    private readonly getMainWindow: () => ElectronBrowserWindow | null,
  ) {
  }

  init(): void {
    console.log('[auto-update] electron-updater disabled (not bundled).');
  }

  async manualCheck(): Promise<void> {
    await this.showInfoDialog('Mises a jour', 'Les mises a jour automatiques sont temporairement desactivees.');
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
