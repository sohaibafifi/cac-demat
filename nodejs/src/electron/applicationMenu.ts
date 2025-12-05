import type { Menu as ElectronMenu, MenuItemConstructorOptions, MenuItem } from 'electron';

type ApplicationMenuOptions = {
  onCheckForUpdates?: () => void | Promise<void>;
};

export class ApplicationMenuBuilder {
  constructor(
    private readonly Menu: typeof ElectronMenu,
    private readonly appName: string,
    private readonly isMac: boolean,
    private readonly options: ApplicationMenuOptions = {},
  ) {}

  build(advancedMode: boolean, onAdvancedModeToggle: (checked: boolean) => void): ElectronMenu {
    const template = this.buildTemplate(advancedMode, onAdvancedModeToggle);
    return this.Menu.buildFromTemplate(template);
  }

  private buildTemplate(advancedMode: boolean, onAdvancedModeToggle: (checked: boolean) => void): MenuItemConstructorOptions[] {
    return [
      ...this.buildAppMenu(),
      this.buildFileMenu(),
      this.buildEditMenu(),
      this.buildViewMenu(advancedMode, onAdvancedModeToggle),
      this.buildWindowMenu(),
      this.buildHelpMenu(),
    ];
  }

  private buildAppMenu(): MenuItemConstructorOptions[] {
    if (!this.isMac) {
      return [];
    }

    return [
      {
        label: this.appName,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
    ];
  }

  private buildFileMenu(): MenuItemConstructorOptions {
    return {
      label: 'File',
      submenu: [this.isMac ? { role: 'close' } : { role: 'quit' }],
    };
  }

  private buildEditMenu(): MenuItemConstructorOptions {
    const commonItems: MenuItemConstructorOptions[] = [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
    ];

    const platformItems: MenuItemConstructorOptions[] = this.isMac
      ? [
          { role: 'pasteAndMatchStyle' },
          { role: 'delete' },
          { role: 'selectAll' },
        ]
      : [
          { role: 'delete' },
          { type: 'separator' },
          { role: 'selectAll' },
        ];

    return {
      label: 'Edit',
      submenu: [...commonItems, ...platformItems],
    };
  }

  private buildViewMenu(advancedMode: boolean, onAdvancedModeToggle: (checked: boolean) => void): MenuItemConstructorOptions {
    return {
      label: 'View',
      submenu: [
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
          click: (menuItem: MenuItem) => onAdvancedModeToggle(menuItem.checked),
        },
      ],
    };
  }

  private buildWindowMenu(): MenuItemConstructorOptions {
    const baseItems: MenuItemConstructorOptions[] = [
      { role: 'minimize' },
      { role: 'zoom' },
    ];

    const platformItems: MenuItemConstructorOptions[] = this.isMac
      ? [
          { type: 'separator' },
          { role: 'front' },
          { role: 'window' },
        ]
      : [{ role: 'close' }];

    return {
      label: 'Window',
      submenu: [...baseItems, ...platformItems],
    };
  }

  private buildHelpMenu(): MenuItemConstructorOptions {
    const submenu: MenuItemConstructorOptions[] = [];

    if (this.options.onCheckForUpdates) {
      submenu.push({
        id: 'check-for-updates',
        label: 'Rechercher des mises a jour...',
        click: () => {
          void this.options.onCheckForUpdates?.();
        },
      });
    }

    return {
      role: 'help',
      submenu,
    };
  }
}
