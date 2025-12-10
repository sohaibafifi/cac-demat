import type { Menu as ElectronMenu, MenuItemConstructorOptions, MenuItem } from 'electron';

type ApplicationMenuOptions = {
  onCheckForUpdates?: () => void | Promise<void>;
  onShowImportHelp?: () => void | Promise<void>;
  onShowUserGuide?: () => void | Promise<void>;
  onShowAbout?: () => void | Promise<void>;
  onStopPipeline?: () => void | Promise<void>;
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
      label: 'Fichier',
      submenu: [this.isMac ? { role: 'close' } : { role: 'quit' }],
    };
  }

  private buildEditMenu(): MenuItemConstructorOptions {
    return {
      label: 'Édition',
      submenu: [
        { role: 'copy' },
        { role: 'paste' },
      ],
    };
  }

  private buildViewMenu(advancedMode: boolean, onAdvancedModeToggle: (checked: boolean) => void): MenuItemConstructorOptions {
    return {
      label: 'Affichage',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Mode avancé',
          id: 'advanced-view-toggle',
          type: 'checkbox',
          checked: advancedMode,
          click: (menuItem: MenuItem) => onAdvancedModeToggle(menuItem.checked),
        },
        { type: 'separator' },
        {
          label: 'Arrêter le pipeline en cours',
          id: 'stop-pipeline',
          accelerator: 'CmdOrCtrl+.',
          enabled: Boolean(this.options.onStopPipeline),
          click: () => {
            void this.options.onStopPipeline?.();
          },
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
      label: 'Fenêtre',
      submenu: [...baseItems, ...platformItems],
    };
  }

  private buildHelpMenu(): MenuItemConstructorOptions {
    const submenu: MenuItemConstructorOptions[] = [];

    if (this.options.onShowAbout) {
      submenu.push({
        id: 'about',
        label: `À propos de ${this.appName}`,
        click: () => {
          void this.options.onShowAbout?.();
        },
      });
    }
    
    if (this.options.onShowUserGuide) {
      submenu.push({
        id: 'user-guide',
        label: 'Guide utilisateur',
        click: () => {
          void this.options.onShowUserGuide?.();
        },
      });
    }

    

    if (this.options.onShowImportHelp) {
      submenu.push({
        id: 'show-import-help',
        label: 'Guide d\'import des fichiers',
        click: () => {
          void this.options.onShowImportHelp?.();
        },
      });
    }

    if (this.options.onCheckForUpdates) {
      if (submenu.length > 0) {
        submenu.push({ type: 'separator' });
      }
      submenu.push({
        id: 'check-for-updates',
        label: 'Rechercher des mises à jour...',
        click: () => {
          void this.options.onCheckForUpdates?.();
        },
      });
    }

    return {
      label: 'Aide',
      role: 'help',
      submenu,
    };
  }
}
