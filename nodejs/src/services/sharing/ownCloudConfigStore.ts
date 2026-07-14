import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

export interface OwnCloudConfig {
  baseUrl: string;
  login: string;
  appPassword: string;
  remoteRootPath: string;
  defaultPermissions: number;
  uploadByDefault: boolean;
  notifyByEmail: boolean;
}

export type PasswordStorage = 'encrypted' | 'session-only' | 'missing';

export interface OwnCloudConfigDescription {
  baseUrl: string;
  login: string;
  remoteRootPath: string;
  hasPassword: boolean;
  passwordStorage: PasswordStorage;
  defaultPermissions: number;
  uploadByDefault: boolean;
  notifyByEmail: boolean;
}

interface PersistedOwnCloudConfig {
  baseUrl: string;
  login: string;
  appPasswordEncrypted: string | null;
  appPasswordPlain?: string | null;
  remoteRootPath: string;
  defaultPermissions: number;
  defaultShareType?: 'user' | 'email';
  uploadByDefault: boolean;
  notifyByEmail?: boolean;
}

interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

const DEFAULT_CONFIG: OwnCloudConfig = {
  baseUrl: 'https://owncloud.univ-artois.fr',
  login: '',
  appPassword: '',
  remoteRootPath: '',
  defaultPermissions: 1,
  uploadByDefault: false,
  notifyByEmail: false,
};

export class OwnCloudConfigStore {
  private cache: OwnCloudConfig | null = null;
  private passwordStorage: PasswordStorage = 'missing';

  constructor(
    private readonly safeStorage: SafeStorageLike,
    private readonly userDataDir: string,
    private readonly fileName = 'owncloud-config.json',
  ) {}

  async load(): Promise<OwnCloudConfig> {
    if (this.cache) {
      return { ...this.cache };
    }
    const filePath = this.resolvePath();
    if (!existsSync(filePath)) {
      this.cache = { ...DEFAULT_CONFIG };
      return { ...this.cache };
    }

    try {
      const raw = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedOwnCloudConfig>;
      const storedPassword = this.readStoredPassword(parsed);
      this.cache = this.normalize({
        ...DEFAULT_CONFIG,
        ...parsed,
        appPassword: storedPassword.password,
      });
      this.passwordStorage = storedPassword.storage;

      if (parsed.appPasswordPlain) {
        await this.persist(this.cache);
      }
    } catch {
      this.cache = { ...DEFAULT_CONFIG };
      this.passwordStorage = 'missing';
    }

    return { ...this.cache };
  }

  async save(next: OwnCloudConfig): Promise<OwnCloudConfig> {
    const normalized = this.normalize(next);
    await this.persist(normalized);
    this.cache = normalized;
    return { ...this.cache };
  }

  async describe(): Promise<OwnCloudConfigDescription> {
    const config = await this.load();
    return {
      baseUrl: config.baseUrl,
      login: config.login,
      remoteRootPath: config.remoteRootPath,
      hasPassword: Boolean(config.appPassword),
      passwordStorage: this.passwordStorage,
      defaultPermissions: config.defaultPermissions,
      uploadByDefault: config.uploadByDefault,
      notifyByEmail: config.notifyByEmail,
    };
  }

  private async persist(config: OwnCloudConfig): Promise<void> {
    const filePath = this.resolvePath();
    await mkdir(path.dirname(filePath), { recursive: true });

    const persisted: PersistedOwnCloudConfig = {
      baseUrl: config.baseUrl,
      login: config.login,
      appPasswordEncrypted: null,
      remoteRootPath: config.remoteRootPath,
      defaultPermissions: config.defaultPermissions,
      uploadByDefault: config.uploadByDefault,
      notifyByEmail: config.notifyByEmail,
    };

    if (config.appPassword && this.safeStorage.isEncryptionAvailable()) {
      persisted.appPasswordEncrypted = this.safeStorage.encryptString(config.appPassword).toString('base64');
      this.passwordStorage = 'encrypted';
    } else {
      this.passwordStorage = config.appPassword ? 'session-only' : 'missing';
    }

    await writeFile(filePath, JSON.stringify(persisted, null, 2), { encoding: 'utf8', mode: 0o600 });
  }

  private normalize(config: OwnCloudConfig): OwnCloudConfig {
    const baseUrl = config.baseUrl.trim().replace(/\/+$/, '');
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(baseUrl);
    } catch {
      throw new Error('URL du serveur ownCloud invalide.');
    }
    if (parsedUrl.protocol !== 'https:') {
      throw new Error('Le serveur ownCloud doit utiliser HTTPS.');
    }

    const permissions = Number(config.defaultPermissions);
    if (!Number.isInteger(permissions) || permissions < 1 || permissions > 31) {
      throw new Error('Permissions ownCloud invalides.');
    }

    return {
      baseUrl,
      login: config.login.trim(),
      appPassword: config.appPassword,
      remoteRootPath: config.remoteRootPath.trim(),
      defaultPermissions: permissions,
      uploadByDefault: Boolean(config.uploadByDefault),
      notifyByEmail: Boolean(config.notifyByEmail),
    };
  }

  private resolvePath(): string {
    return path.join(this.userDataDir, this.fileName);
  }

  private readStoredPassword(parsed: Partial<PersistedOwnCloudConfig>): {
    password: string;
    storage: PasswordStorage;
  } {
    if (parsed.appPasswordPlain) {
      return {
        password: parsed.appPasswordPlain,
        storage: this.safeStorage.isEncryptionAvailable() ? 'encrypted' : 'session-only',
      };
    }
    const encrypted = parsed.appPasswordEncrypted;
    if (!encrypted || !this.safeStorage.isEncryptionAvailable()) {
      return { password: '', storage: 'missing' };
    }
    try {
      return {
        password: this.safeStorage.decryptString(Buffer.from(encrypted, 'base64')),
        storage: 'encrypted',
      };
    } catch {
      return { password: '', storage: 'missing' };
    }
  }
}
