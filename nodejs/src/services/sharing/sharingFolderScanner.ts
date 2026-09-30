import { readdir, stat } from 'fs/promises';
import path from 'path';

export interface DiscoveredRecipient {
  name: string;
  absolutePath: string;
  relativePath: string;
  suggestedUsername: string;
}

export const deriveOwnCloudUsername = (name: string): string => {
  const normalized = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[-’']/g, '');
  const parts = normalized.split(/[^a-zA-Z0-9]+/g).filter(Boolean);
  const unchangedOrder = parts.join('.').toLowerCase();

  // A dotted login already specifies its order. For names, infer the surname
  // only when an uppercase block distinguishes it from the given name.
  if (normalized.includes('.') || parts.length < 2) return unchangedOrder;
  const isSurnamePart = (part: string): boolean => /[A-Z]/.test(part) && part === part.toUpperCase();
  const isGivenNamePart = (part: string): boolean => /[a-z]/.test(part);
  const formatName = (given: string[], family: string[]): string => {
    // A lone capital initial is not enough evidence to infer a surname.
    if (family.join('').replace(/[^A-Z]/g, '').length < 2) return unchangedOrder;
    return `${given.join('')}.${family.join('')}`.toLowerCase();
  };

  const firstGiven = parts.findIndex(isGivenNamePart);
  if (firstGiven > 0 && parts.slice(0, firstGiven).every(isSurnamePart)
    && parts.slice(firstGiven).every(isGivenNamePart)) {
    return formatName(parts.slice(firstGiven), parts.slice(0, firstGiven));
  }
  const firstSurname = parts.findIndex(isSurnamePart);
  if (firstSurname > 0 && parts.slice(0, firstSurname).every(isGivenNamePart)
    && parts.slice(firstSurname).every(isSurnamePart)) {
    return formatName(parts.slice(0, firstSurname), parts.slice(firstSurname));
  }
  return unchangedOrder;
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
