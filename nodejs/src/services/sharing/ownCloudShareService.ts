import { createReadStream } from 'fs';
import { readdir, stat } from 'fs/promises';
import path from 'path';

export interface OwnCloudCredentials {
  baseUrl: string;
  login: string;
  appPassword: string;
}

export type OwnCloudShareType = 'user' | 'group' | 'email';

export interface CreateShareInput extends OwnCloudCredentials {
  remotePath: string;
  shareWith: string;
  shareType: OwnCloudShareType;
  permissions?: number;
  expireDate?: string;
}

export interface ShareEntry {
  id: string;
  shareWith: string;
  shareType: OwnCloudShareType;
  permissions: number;
  url: string | null;
  path: string;
  itemSource: string | null;
  itemType: string | null;
  mailSent: boolean;
}

export interface CreateShareResult {
  share: ShareEntry;
  alreadyExisted: boolean;
}

export interface OwnCloudConnectionResult {
  user: string;
  displayName: string | null;
  serverVersion: string | null;
  productName: string | null;
  sharingApiEnabled: boolean | null;
  mailNotificationAvailable: boolean | null;
  webdavAvailable: boolean;
}

export interface UploadDirectoryResult {
  uploaded: number;
  total: number;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const SHARE_TYPE_CODES: Record<OwnCloudShareType, number> = {
  user: 0,
  group: 1,
  email: 4,
};

const SHARE_TYPE_FROM_CODE: Record<number, OwnCloudShareType> = {
  0: 'user',
  1: 'group',
  4: 'email',
};

const DEFAULT_PERMISSIONS = 1;

export class OwnCloudShareService {
  constructor(private readonly fetchFn: FetchLike = globalThis.fetch.bind(globalThis)) {}

  async testConnection(credentials: OwnCloudCredentials, signal?: AbortSignal): Promise<OwnCloudConnectionResult> {
    const statusUrl = `${this.normalizeBaseUrl(credentials.baseUrl)}/status.php`;
    const [statusResponse, userPayload, capabilitiesPayload, webdavResponse] = await Promise.all([
      this.fetchFn(statusUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal,
      }),
      this.fetchOcs(credentials, '/ocs/v2.php/cloud/user', { method: 'GET', signal }),
      this.fetchOcs(credentials, '/ocs/v2.php/cloud/capabilities', { method: 'GET', signal }),
      this.fetchFn(this.buildWebdavUrl(credentials, '/'), {
        method: 'PROPFIND',
        headers: {
          ...this.buildHeaders(credentials),
          Depth: '0',
        },
        signal,
      }),
    ]);

    const status = await this.readServerStatus(statusResponse);
    if (webdavResponse.status !== 207) {
      const detail = await this.readResponseSnippet(webdavResponse);
      throw new Error(`Accès WebDAV refusé (HTTP ${webdavResponse.status}): ${detail}`);
    }

    const userData = this.asRecord(userPayload.data);
    const id = userData.id ?? userData.uid;
    if (!id) {
      throw new Error('Réponse ownCloud invalide: identifiant utilisateur manquant.');
    }

    const capabilities = this.asRecord(this.asRecord(capabilitiesPayload.data).capabilities);
    const fileSharing = this.asRecord(capabilities.files_sharing);
    const sharingApiEnabled = typeof fileSharing.api_enabled === 'boolean'
      ? fileSharing.api_enabled
      : null;
    const userSharing = this.asRecord(fileSharing.user);
    const mailNotificationAvailable = typeof userSharing.send_mail === 'boolean'
      ? userSharing.send_mail
      : null;

    return {
      user: String(id),
      displayName: this.resolveOptionalString(userData['display-name'] ?? userData.displayname),
      serverVersion: status.versionstring,
      productName: status.productname,
      sharingApiEnabled,
      mailNotificationAvailable,
      webdavAvailable: true,
    };
  }

  async listSharesForPath(
    credentials: OwnCloudCredentials,
    remotePath: string,
    signal?: AbortSignal,
  ): Promise<ShareEntry[]> {
    const search = new URLSearchParams({ path: remotePath, reshares: 'true' });
    const payload = await this.fetchOcs(
      credentials,
      `/ocs/v2.php/apps/files_sharing/api/v1/shares?${search.toString()}`,
      { method: 'GET', signal },
    );
    return this.extractElements(payload.data).map((element) => this.parseShare(element));
  }

  async createShare(
    input: CreateShareInput,
    signal?: AbortSignal,
  ): Promise<CreateShareResult> {
    const existing = await this.findExistingShare(input, signal);
    if (existing) {
      return { share: existing, alreadyExisted: true };
    }

    const body = new URLSearchParams();
    body.set('path', input.remotePath);
    body.set('shareType', String(SHARE_TYPE_CODES[input.shareType]));
    body.set('shareWith', input.shareWith);
    body.set('permissions', String(input.permissions ?? DEFAULT_PERMISSIONS));
    if (input.expireDate) {
      body.set('expireDate', input.expireDate);
    }

    const payload = await this.fetchOcs(
      input,
      '/ocs/v2.php/apps/files_sharing/api/v1/shares',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal,
      },
    );
    return { share: this.parseShare(payload.data), alreadyExisted: false };
  }

  async sendShareNotification(
    credentials: OwnCloudCredentials,
    share: ShareEntry,
    signal?: AbortSignal,
  ): Promise<void> {
    if (share.shareType !== 'user' && share.shareType !== 'group') {
      throw new Error('La notification par e-mail est réservée aux partages utilisateur ou groupe.');
    }
    if (!share.itemSource || !share.itemType || !share.shareWith) {
      throw new Error('ownCloud n’a pas fourni les informations nécessaires à la notification.');
    }

    const body = new URLSearchParams();
    body.set('itemSource', share.itemSource);
    body.set('itemType', share.itemType);
    body.set('shareType', String(SHARE_TYPE_CODES[share.shareType]));
    body.set('recipient', share.shareWith);

    const payload = await this.fetchOcs(
      credentials,
      '/ocs/v2.php/apps/files_sharing/api/v1/notification/send',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal,
      },
    );
    const data = this.asRecord(payload.data);
    if (data.status && data.status !== 'success') {
      throw new Error(payload.message ?? 'ownCloud n’a pas pu envoyer la notification par e-mail.');
    }
  }

  async ensureRemoteDirectory(
    credentials: OwnCloudCredentials,
    remotePath: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const segments = this.splitRemotePath(remotePath);
    let cursor = '';
    for (const segment of segments) {
      cursor = `${cursor}/${segment}`;
      const response = await this.fetchFn(this.buildWebdavUrl(credentials, cursor), {
        method: 'MKCOL',
        headers: this.buildHeaders(credentials),
        signal,
      });
      if (response.status === 201 || response.status === 405) {
        continue;
      }
      const detail = await this.readResponseSnippet(response);
      throw new Error(`Création du dossier ${cursor} impossible (HTTP ${response.status}): ${detail}`);
    }
  }

  async uploadDirectory(
    credentials: OwnCloudCredentials,
    localDirectory: string,
    remoteDirectory: string,
    onProgress?: (info: { current: number; total: number; relative: string }) => void,
    signal?: AbortSignal,
  ): Promise<UploadDirectoryResult> {
    const files = await this.collectFiles(localDirectory);
    let uploaded = 0;

    await this.ensureRemoteDirectory(credentials, remoteDirectory, signal);
    const ensuredDirs = new Set<string>([remoteDirectory]);

    for (let index = 0; index < files.length; index += 1) {
      this.throwIfAborted(signal);
      const file = files[index];
      const remotePath = this.joinRemote(remoteDirectory, file.relative);
      const relativeDirectory = path.dirname(file.relative);
      const remoteDirOfFile = relativeDirectory === '.'
        ? remoteDirectory
        : this.joinRemote(remoteDirectory, relativeDirectory.split(path.sep).join('/'));
      if (!ensuredDirs.has(remoteDirOfFile)) {
        await this.ensureRemoteDirectory(credentials, remoteDirOfFile, signal);
        ensuredDirs.add(remoteDirOfFile);
      }

      onProgress?.({ current: index + 1, total: files.length, relative: file.relative });

      const uploadInit: RequestInit & { duplex: 'half' } = {
        method: 'PUT',
        headers: {
          ...this.buildHeaders(credentials),
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(file.size),
        },
        body: createReadStream(file.absolute) as unknown as BodyInit,
        duplex: 'half',
        signal,
      };
      const response = await this.fetchFn(this.buildWebdavUrl(credentials, remotePath), uploadInit);
      if (response.status === 201 || response.status === 204) {
        uploaded += 1;
        continue;
      }
      const detail = await this.readResponseSnippet(response);
      throw new Error(`Envoi de ${file.relative} impossible (HTTP ${response.status}): ${detail}`);
    }

    return { uploaded, total: files.length };
  }

  private async findExistingShare(
    input: CreateShareInput,
    signal?: AbortSignal,
  ): Promise<ShareEntry | null> {
    const shares = await this.listSharesForPath(input, input.remotePath, signal);
    const target = input.shareWith.trim().toLowerCase();
    return shares.find((share) =>
      share.shareType === input.shareType && share.shareWith.trim().toLowerCase() === target,
    ) ?? null;
  }

  private async fetchOcs(
    credentials: OwnCloudCredentials,
    endpoint: string,
    init: RequestInit,
  ): Promise<{ data: unknown; message: string | null }> {
    const response = await this.fetchFn(this.buildOcsUrl(credentials.baseUrl, endpoint), {
      ...init,
      headers: {
        ...this.buildHeaders(credentials),
        ...(init.headers ?? {}),
      },
    });
    return this.readOcsPayload(response);
  }

  private async collectFiles(rootDir: string): Promise<Array<{ absolute: string; relative: string; size: number }>> {
    const files: Array<{ absolute: string; relative: string; size: number }> = [];
    const rootStats = await stat(rootDir);
    if (!rootStats.isDirectory()) {
      throw new Error(`Chemin local invalide: ${rootDir}`);
    }

    const walk = async (current: string): Promise<void> => {
      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await walk(absolute);
        } else if (entry.isFile()) {
          const fileStats = await stat(absolute);
          files.push({
            absolute,
            relative: path.relative(rootDir, absolute),
            size: fileStats.size,
          });
        }
      }
    };
    await walk(rootDir);
    files.sort((a, b) => a.relative.localeCompare(b.relative, 'fr'));
    return files;
  }

  private splitRemotePath(remotePath: string): string[] {
    const segments = remotePath
      .split('/')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
    if (segments.some((segment) => segment === '.' || segment === '..' || segment.includes('\0'))) {
      throw new Error('Le chemin distant ownCloud contient un segment interdit.');
    }
    return segments;
  }

  private joinRemote(base: string, relative: string): string {
    const baseSegments = this.splitRemotePath(base);
    const relativeSegments = this.splitRemotePath(relative.split(path.sep).join('/'));
    return `/${[...baseSegments, ...relativeSegments].join('/')}`;
  }

  private buildWebdavUrl(credentials: OwnCloudCredentials, remotePath: string): string {
    const segments = this.splitRemotePath(remotePath).map((segment) => encodeURIComponent(segment));
    return `${this.normalizeBaseUrl(credentials.baseUrl)}/remote.php/dav/files/${encodeURIComponent(credentials.login)}/${segments.join('/')}`;
  }

  private buildOcsUrl(baseUrl: string, endpoint: string): string {
    const separator = endpoint.includes('?') ? '&' : '?';
    return `${this.normalizeBaseUrl(baseUrl)}${endpoint}${separator}format=json`;
  }

  private normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.trim().replace(/\/+$/, '');
  }

  private buildHeaders(credentials: OwnCloudCredentials): Record<string, string> {
    const token = Buffer.from(`${credentials.login}:${credentials.appPassword}`, 'utf8').toString('base64');
    return {
      Authorization: `Basic ${token}`,
      'OCS-APIRequest': 'true',
      Accept: 'application/json',
      'User-Agent': 'cac-demat-owncloud-client/1.0',
    };
  }

  private async readOcsPayload(response: Response): Promise<{ data: unknown; message: string | null }> {
    const raw = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      const snippet = this.summarizeNonJson(raw);
      throw new Error(`ownCloud a répondu ${response.status} avec un contenu inattendu: ${snippet}`);
    }

    const ocs = this.asRecord(this.asRecord(payload).ocs);
    const meta = this.asRecord(ocs.meta);
    const statusCode = Number(meta.statuscode ?? 0);
    const success = response.ok && (
      meta.status === 'ok' ||
      statusCode === 100 ||
      (statusCode >= 200 && statusCode < 300)
    );
    if (!success) {
      const message = this.resolveOptionalString(meta.message) ?? `Erreur OCS ${statusCode || response.status}`;
      throw new Error(`${message} (HTTP ${response.status}, OCS ${statusCode || 'inconnu'}).`);
    }
    return { data: ocs.data, message: this.resolveOptionalString(meta.message) };
  }

  private async readServerStatus(response: Response): Promise<{ versionstring: string | null; productname: string | null }> {
    if (!response.ok) {
      throw new Error(`Statut du serveur ownCloud inaccessible (HTTP ${response.status}).`);
    }
    try {
      const status = this.asRecord(await response.json());
      if (status.installed !== true || status.maintenance === true) {
        throw new Error('Le serveur ownCloud est indisponible ou en maintenance.');
      }
      return {
        versionstring: this.resolveOptionalString(status.versionstring),
        productname: this.resolveOptionalString(status.productname),
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('maintenance')) {
        throw error;
      }
      throw new Error('Réponse de statut ownCloud invalide.');
    }
  }

  private async readResponseSnippet(response: Response): Promise<string> {
    const raw = await response.text().catch(() => '');
    return this.summarizeNonJson(raw);
  }

  private summarizeNonJson(raw: string): string {
    const stripped = raw
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return stripped.length > 220 ? `${stripped.slice(0, 220)}...` : stripped || 'réponse vide';
  }

  private extractElements(data: unknown): unknown[] {
    if (Array.isArray(data)) {
      return data;
    }
    const record = this.asRecord(data);
    if ('element' in record) {
      return Array.isArray(record.element) ? record.element : [record.element];
    }
    return [];
  }

  private parseShare(element: unknown): ShareEntry {
    const record = this.asRecord(element);
    if (Object.keys(record).length === 0) {
      throw new Error('Réponse ownCloud vide lors de la création du partage.');
    }
    const code = Number(record.share_type ?? record.shareType ?? -1);
    return {
      id: String(record.id ?? record.share_id ?? ''),
      shareWith: String(record.share_with ?? record.shareWith ?? ''),
      shareType: SHARE_TYPE_FROM_CODE[code] ?? 'user',
      permissions: Number(record.permissions ?? DEFAULT_PERMISSIONS),
      url: this.resolveOptionalString(record.url),
      path: String(record.path ?? record.file_target ?? ''),
      itemSource: this.resolveOptionalString(record.item_source ?? record.file_source),
      itemType: this.resolveOptionalString(record.item_type),
      mailSent: Number(record.mail_send ?? 0) === 1 || record.mail_send === true,
    };
  }

  private asRecord(value: unknown): Record<string, any> {
    return value && typeof value === 'object' ? value as Record<string, any> : {};
  }

  private resolveOptionalString(value: unknown): string | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    return String(value);
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new DOMException('Opération annulée.', 'AbortError');
    }
  }
}
