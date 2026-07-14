import { readdir, stat } from 'fs/promises';
import path from 'path';

export interface DiscoveredRecipient {
  name: string;
  absolutePath: string;
  relativePath: string;
  suggestedUsername: string;
}

export const deriveOwnCloudUsername = (name: string): string => {
  const parts = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^a-z0-9-]+/g)
    .filter(Boolean);
  if (parts.length < 2) {
    return parts[0] ?? '';
  }
  return [parts[parts.length - 1], ...parts.slice(0, -1)].join('.');
};

export class SharingFolderScanner {
  async scan(rootDir: string): Promise<DiscoveredRecipient[]> {
    const trimmed = rootDir.trim();
    if (!trimmed) {
      throw new Error('Dossier de partage non renseigné.');
    }

    const stats = await stat(trimmed);
    if (!stats.isDirectory()) {
      throw new Error(`Chemin invalide: ${trimmed}`);
    }

    const entries = await readdir(trimmed, { withFileTypes: true });
    const recipients: DiscoveredRecipient[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || this.shouldSkip(entry.name)) {
        continue;
      }
      const absolute = path.join(trimmed, entry.name);
      recipients.push({
        name: entry.name,
        absolutePath: absolute,
        relativePath: entry.name,
        suggestedUsername: deriveOwnCloudUsername(entry.name),
      });
    }

    recipients.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return recipients;
  }

  private shouldSkip(name: string): boolean {
    return name.startsWith('.') || name === 'node_modules' || name === '__MACOSX';
  }
}
