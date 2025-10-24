import { mkdir, realpath } from 'fs/promises';
import {
  PdfPackageProcessor,
  PdfPackage,
  PdfInventoryEntry,
  PipelineLogger,
  PreparationStats,
} from '../pdf/pdfPackageProcessor.js';

export interface MemberEntry {
  name: string;
  files?: string[];
}

export class MemberPreparationService {
  constructor(private readonly packageProcessor: PdfPackageProcessor) {}

  async prepare(
    members: MemberEntry[],
    sourceDir: string,
    outputDir: string,
    collectionName: string,
    logger?: PipelineLogger,
  ): Promise<PreparationStats> {
    const resolvedSourceDir = await this.resolveSourceDir(sourceDir);
    await mkdir(outputDir, { recursive: true, mode: 0o755 });

    const inventory = await this.packageProcessor.collectPdfFiles(resolvedSourceDir);
    if (inventory.length === 0) {
      throw new Error(`Aucun fichier PDF trouvé dans ${sourceDir}.`);
    }

    const packages: PdfPackage[] = [];

    for (const entry of members) {
      const name = entry.name?.trim?.() ?? '';
      if (name === '') {
        continue;
      }

      const requested = (entry.files ?? [])
        .map((value) => (value ?? '').toString().trim())
        .filter((value) => value !== '');

      let files: string[];
      if (requested.length === 0) {
        files = inventory.map((item) => item.relative);
      } else {
        files = this.resolveRequestedFiles(requested, inventory, logger);
      }

      if (files.length === 0) {
        this.log(logger, `Aucun fichier attribué pour le membre ${name}. Attribution ignorée.`);
        continue;
      }

      packages.push({ name, files });
    }

    if (packages.length === 0) {
      return {
        requestedRecipients: 0,
        processedRecipients: 0,
        processedFiles: 0,
        missingFiles: [],
      };
    }

    return this.packageProcessor.prepare(
      packages,
      resolvedSourceDir,
      outputDir,
      'member',
      collectionName,
      logger,
      inventory,
    );
  }

  private async resolveSourceDir(sourceDir: string): Promise<string> {
    const resolved = await realpath(sourceDir).catch(() => null);
    if (!resolved) {
      throw new Error(`Dossier source introuvable: ${sourceDir}`);
    }

    return resolved;
  }

  private resolveRequestedFiles(
    requested: string[],
    inventory: PdfInventoryEntry[],
    logger?: PipelineLogger,
  ): string[] {
    const lookup = new Map<string, string>();
    const indexed: Array<{ relative: string; lower: string }> = [];

    for (const entry of inventory) {
      const lower = entry.relative.toLowerCase();
      lookup.set(lower, entry.relative);
      indexed.push({ relative: entry.relative, lower });
    }

    const resolved: string[] = [];

    for (const rawPath of requested) {
      const normalised = this.normaliseRequestedPath(rawPath);
      if (normalised === '') {
        continue;
      }

      const lower = normalised.toLowerCase();

      if (lookup.has(lower)) {
        resolved.push(lookup.get(lower)!);
        continue;
      }

      const folderCandidate = lower.replace(/\/$/, '');
      if (folderCandidate !== '') {
        const prefix = `${folderCandidate}/`;
        const matches = indexed
          .filter((item) => item.lower.startsWith(prefix))
          .map((item) => item.relative);

        if (matches.length > 0) {
          resolved.push(...matches);
          continue;
        }
      }

      this.log(logger, `Affectation CSV: aucun fichier ou dossier ne correspond à "${rawPath}".`);
    }

    const unique = Array.from(new Set(resolved));
    unique.sort((a, b) => a.localeCompare(b));

    return unique;
  }

  private normaliseRequestedPath(pathname: string): string {
    const trimmed = pathname.trim();
    if (trimmed === '') {
      return '';
    }

    let normalised = trimmed.replace(/\\/g, '/');
    normalised = normalised.replace(/\/+/g, '/');
    normalised = normalised.replace(/^\.\/+/, '');
    normalised = normalised.replace(/^\/+/, '');

    return normalised;
  }

  private log(logger: PipelineLogger | undefined, message: string): void {
    logger?.(message);
  }
}
