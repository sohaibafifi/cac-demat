import { mkdir, realpath } from 'fs/promises';
import {
  PdfPackageProcessor,
  PdfPackage,
  PdfInventoryEntry,
  PipelineLogger,
  PreparationStats,
  PipelineProgress,
} from '../pdf/pdfPackageProcessor.js';

export interface ReviewerPackage {
  name: string;
  files: string[];
}

export class ReviewerPreparationService {
  constructor(private readonly packageProcessor: PdfPackageProcessor) {}

  async prepare(
    packages: ReviewerPackage[],
    sourceDir: string,
    outputDir: string,
    collectionName: string,
    logger?: PipelineLogger,
    progress?: (progress: PipelineProgress) => void,
  ): Promise<PreparationStats> {
    const resolvedSourceDir = await realpath(sourceDir);
    await mkdir(outputDir, { recursive: true, mode: 0o755 });

    const inventory = await this.packageProcessor.collectPdfFiles(resolvedSourceDir);

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

    return this.packageProcessor.prepare(
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
    );
  }
}
