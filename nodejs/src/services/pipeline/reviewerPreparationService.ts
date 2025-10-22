import { mkdir, realpath } from 'fs/promises';
import { PdfPackageProcessor, PdfPackage, PdfInventoryEntry, PipelineLogger } from '../pdf/pdfPackageProcessor.js';

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
  ): Promise<void> {
    const resolvedSourceDir = await this.resolveSourceDir(sourceDir);
    await mkdir(outputDir, { recursive: true, mode: 0o755 });

    const inventory = await this.packageProcessor.collectPdfFiles(resolvedSourceDir);

    const normalisedPackages: PdfPackage[] = [];
    for (const pkg of packages) {
      const name = pkg.name?.trim?.() ?? '';
      if (name === '') {
        continue;
      }

      const files = (pkg.files ?? [])
        .map((file) => (file ?? '').toString().trim())
        .filter((file) => file !== '');

      if (files.length === 0) {
        continue;
      }

      normalisedPackages.push({ name, files });
    }

    if (normalisedPackages.length === 0) {
      return;
    }

    await this.packageProcessor.prepare(
      normalisedPackages,
      resolvedSourceDir,
      outputDir,
      'reviewer',
      collectionName,
      logger,
      inventory,
      async (file: PdfInventoryEntry, recipient: string, _restricted: boolean, password: string | null) => {
        const displayPassword = password ?? '';
        this.log(logger, `Processed ${file.relative} for ${recipient} (owner password: ${displayPassword})`);
      },
    );
  }

  private async resolveSourceDir(sourceDir: string): Promise<string> {
    const resolved = await realpath(sourceDir).catch(() => null);
    if (!resolved) {
      throw new Error(`Dossier source introuvable: ${sourceDir}`);
    }

    return resolved;
  }

  private log(logger: PipelineLogger | undefined, message: string): void {
    logger?.(message);
  }
}
