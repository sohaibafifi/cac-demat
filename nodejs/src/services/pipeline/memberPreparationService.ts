import { mkdir, realpath } from 'fs/promises';
import path from 'path';
import {
  PdfPackageProcessor,
  PdfPackage,
  PdfInventoryEntry,
  PipelineLogger,
  PreparationStats,
  PipelineProgress,
} from '../pdf/pdfPackageProcessor.js';
import { NameSanitizer } from '../../support/text/nameSanitizer.js';
import { ZipService, ZipTarget } from '../zip/zipService.js';

export interface MemberEntry {
  name: string;
  files?: string[];
}

export class MemberPreparationService {
  constructor(
    private readonly packageProcessor: PdfPackageProcessor,
    private readonly zipService: ZipService,
  ) {}

  async prepare(
    members: MemberEntry[],
    sourceDir: string,
    outputDir: string,
    collectionName: string,
  logger?: PipelineLogger,
  progress?: (progress: PipelineProgress) => void,
  abortSignal?: AbortSignal,
  zipEnabled = true,
): Promise<PreparationStats> {
    const resolvedSourceDir = await realpath(sourceDir);
    await mkdir(outputDir, { recursive: true, mode: 0o755 });

    const inventory = await this.packageProcessor.collectPdfFiles(resolvedSourceDir, abortSignal);
    if (inventory.length === 0) {
      throw new Error(`Aucun fichier PDF trouvé dans ${sourceDir}.`);
    }

    const packages: PdfPackage[] = [];

    for (const entry of members) {
      const name = entry.name.trim();
      if (!name) continue;

      const requested = (entry.files || []).map((f) => f.trim()).filter((f) => f);

      // If no files specified, use all files
      const files = requested.length === 0
        ? inventory.map((item) => item.relative)
        : this.resolveRequestedFiles(requested, inventory, logger);

      if (files.length === 0) {
        logger?.(`Aucun fichier attribué pour le membre ${name}. Attribution ignorée.`);
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

    const zipTargets = zipEnabled
      ? this.buildZipTargets(packages, outputDir, collectionName)
      : [];

    const stats = await this.packageProcessor.prepare(
      packages,
      resolvedSourceDir,
      outputDir,
      'member',
      collectionName,
      logger,
      inventory,
      undefined,
      progress,
      abortSignal,
    );

    if (zipTargets.length > 0 && zipEnabled) {
      await this.zipService.zipAll(zipTargets, { logger, abortSignal });
    }

    return stats;
  }

  private resolveRequestedFiles(
    requested: string[],
    inventory: PdfInventoryEntry[],
    logger?: PipelineLogger,
  ): string[] {
    const lookup = new Map(inventory.map((e) => [e.relative.toLowerCase(), e.relative]));
    const resolved: string[] = [];

    for (const pattern of requested) {
      const trimmed = pattern.trim();
      if (!trimmed) continue;

      const lower = trimmed.toLowerCase();

      // Special case: "." matches only root level files (no subdirectories)
      if (trimmed === '.') {
        const rootFiles = inventory.filter((e) => !e.relative.includes('/'));
        resolved.push(...rootFiles.map((m) => m.relative));
        continue;
      }

      // Exact file match
      if (lookup.has(lower)) {
        resolved.push(lookup.get(lower)!);
        continue;
      }

      // Folder match (e.g., "sample_1/" or "sample_1")
      const folderPattern = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
      const folderMatches = inventory.filter((e) => {
        const lowerRelative = e.relative.toLowerCase();
        const lowerFolder = folderPattern.toLowerCase();
        // Match files inside the folder (folder/file.pdf)
        return lowerRelative.startsWith(lowerFolder + '/');
      });

      if (folderMatches.length > 0) {
        resolved.push(...folderMatches.map((m) => m.relative));
        continue;
      }

      // Wildcard match
      if (trimmed.includes('*')) {
        const regex = new RegExp('^' + trimmed.replace(/\*/g, '.*') + '$', 'i');
        const matches = inventory.filter((e) => regex.test(e.relative));

        if (matches.length > 0) {
          resolved.push(...matches.map((m) => m.relative));
        } else {
          logger?.(`Aucun fichier correspondant au motif: ${trimmed}`);
        }
      } else {
        logger?.(`Fichier introuvable: ${trimmed}`);
      }
    }

    return [...new Set(resolved)];
  }

  private buildZipTargets(packages: PdfPackage[], outputDir: string, collectionName: string): ZipTarget[] {
    const uniqueTargets = new Map<string, ZipTarget>();
    const collectionLabel = NameSanitizer.sanitizeForFileName(collectionName, 'collection');
    const collectionFolder = collectionName.trim()
      ? NameSanitizer.sanitize(collectionName, 'collection')
      : null;

    for (const pkg of packages) {
      const recipient = pkg.name.trim();
      if (!recipient) continue;

      const folderName = NameSanitizer.sanitize(recipient, 'member');
      const recipientDir = path.join(outputDir, folderName);
      const baseDir = collectionFolder ? path.join(recipientDir, collectionFolder) : recipientDir;
      const zipName = `${collectionLabel} - ${NameSanitizer.sanitizeForFileName(recipient, 'destinataire')}.zip`;
      const zipPath = path.join(recipientDir, zipName);

      uniqueTargets.set(baseDir, { sourceDir: baseDir, zipPath, label: recipient });
    }

    return Array.from(uniqueTargets.values());
  }
}
