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

export interface ReviewerPackage {
  name: string;
  files: string[];
}

export class ReviewerPreparationService {
  constructor(
    private readonly packageProcessor: PdfPackageProcessor,
    private readonly zipService: ZipService,
  ) {}

  async prepare(
    packages: ReviewerPackage[],
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

    const normalisedPackages: PdfPackage[] = packages
      .map((pkg) => ({
        name: pkg.name.trim(),
        files: pkg.files.map((f) => f.trim()).filter((f) => f),
      }))
      .filter((pkg) => pkg.name && pkg.files.length > 0);

    if (normalisedPackages.length === 0) {
      return {
        requestedRecipients: packages.length,
        processedRecipients: 0,
        processedFiles: 0,
        missingFiles: [],
      };
    }

    const zipTargets = zipEnabled
      ? this.buildZipTargets(normalisedPackages, outputDir, collectionName)
      : [];

    const stats = await this.packageProcessor.prepare(
      normalisedPackages,
      resolvedSourceDir,
      outputDir,
      'reviewer',
      collectionName,
      logger,
      inventory,
      async (file: PdfInventoryEntry, recipient: string, _restricted: boolean, password: string | null) => {
        logger?.((`Processed ${file.relative} for ${recipient} (owner password: ${password || ''})`));
      },
      progress,
      abortSignal,
    );

    if (zipTargets.length > 0 && zipEnabled) {
      await this.zipService.zipAll(zipTargets, { logger, abortSignal });
    }

    return stats;
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

      const folderName = NameSanitizer.sanitize(recipient, 'reviewer');
      const recipientDir = path.join(outputDir, folderName);
      const baseDir = collectionFolder ? path.join(recipientDir, collectionFolder) : recipientDir;
      const zipName = `${collectionLabel} - ${NameSanitizer.sanitizeForFileName(recipient, 'destinataire')}.zip`;
      const zipPath = path.join(recipientDir, zipName);

      uniqueTargets.set(baseDir, { sourceDir: baseDir, zipPath, label: recipient });
    }

    return Array.from(uniqueTargets.values());
  }
}
