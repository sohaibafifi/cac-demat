import { mkdir, readdir } from 'fs/promises';
import path from 'path';
import { PdfProcessingPipeline } from '../pipeline/pdfProcessingPipeline.js';
import { NameSanitizer } from '../../support/text/nameSanitizer.js';
import { PdfProcessingContext } from './pdfProcessingContext.js';

export interface PdfInventoryEntry {
  path: string;
  relative: string;
  relativeDir: string;
  basename: string;
}

export interface PdfPackage {
  name: string;
  files: string[];
}

export type PipelineLogger = (message: string) => void;
export type AfterFileProcessed = (
  file: PdfInventoryEntry,
  recipient: string,
  restricted: boolean,
  password: string | null,
) => void | Promise<void>;

export interface PreparationStats {
  requestedRecipients: number;
  processedRecipients: number;
  processedFiles: number;
  missingFiles: string[];
}

export class PdfPackageProcessor {
  constructor(private readonly pipeline: PdfProcessingPipeline) {}

  async prepare(
    packages: PdfPackage[],
    resolvedSourceDir: string,
    outputDir: string,
    sanitizeContext: string,
    collectionName = '',
    logger?: PipelineLogger,
    inventory?: PdfInventoryEntry[],
    afterFileProcessed?: AfterFileProcessed,
  ): Promise<PreparationStats> {
    const entries = inventory ?? (await this.collectPdfFiles(resolvedSourceDir));
    const lookup = new Map(entries.map((e) => [e.relative.toLowerCase(), e]));

    const collectionFolder = collectionName.trim()
      ? NameSanitizer.sanitize(collectionName.trim(), 'collection')
      : null;

    const stats: PreparationStats = {
      requestedRecipients: packages.length,
      processedRecipients: 0,
      processedFiles: 0,
      missingFiles: [],
    };
    const missing = new Set<string>();

    for (const pkg of packages) {
      const name = pkg.name.trim();
      if (!name) continue;

      const folderName = NameSanitizer.sanitize(name, sanitizeContext);
      const recipientDir = path.join(outputDir, folderName);
      await mkdir(recipientDir, { recursive: true, mode: 0o755 });

      const baseDir = collectionFolder ? path.join(recipientDir, collectionFolder) : recipientDir;
      await mkdir(baseDir, { recursive: true, mode: 0o755 });

      const files = pkg.files.map((f) => f.trim()).filter((f) => f);
      if (files.length === 0) continue;

      const useDefaultLogging = !afterFileProcessed;
      let processedForRecipient = 0;

      for (const relative of files) {
        const file = lookup.get(relative.toLowerCase());

        if (!file) {
          logger?.(`Warning: Source file ${relative} not found. Skipping for ${name}.`);
          missing.add(relative);
          continue;
        }

        const destinationDir = file.relativeDir ? path.join(baseDir, file.relativeDir) : baseDir;
        await mkdir(destinationDir, { recursive: true, mode: 0o755 });

        const context = new PdfProcessingContext(
          file.path,
          file.relative,
          name,
          destinationDir,
          file.basename,
          { temporaryPaths: [], password: null, useDefaultLogging },
        );

        const result = await this.pipeline.process(context, logger);
        processedForRecipient += 1;
        stats.processedFiles += 1;

        if (afterFileProcessed) {
          await afterFileProcessed(file, name, true, result.password);
        } else if (!useDefaultLogging && result.password) {
          logger?.(`Processed ${file.relative} for ${name} (owner password: ${result.password})`);
        }
      }

      if (processedForRecipient > 0) {
        stats.processedRecipients += 1;
      }
    }

    stats.missingFiles = Array.from(missing).sort((a, b) => a.localeCompare(b));
    return stats;
  }

  async collectPdfFiles(resolvedSourceDir: string): Promise<PdfInventoryEntry[]> {
    const files: PdfInventoryEntry[] = [];

    const walk = async (current: string): Promise<void> => {
      const entries = await readdir(current, { withFileTypes: true });

      for (const dirent of entries) {
        const fullPath = path.join(current, dirent.name);

        if (dirent.isDirectory()) {
          await walk(fullPath);
          continue;
        }

        if (dirent.isFile() && dirent.name.toLowerCase().endsWith('.pdf')) {
          const relative = path.relative(resolvedSourceDir, fullPath).split(path.sep).join('/');
          const relativeDir = path.dirname(relative) === '.' ? '' : path.dirname(relative).split(path.sep).join('/');

          files.push({
            path: fullPath,
            relative,
            relativeDir,
            basename: path.basename(fullPath),
          });
        }
      }
    };

    await walk(resolvedSourceDir);
    files.sort((a, b) => a.relative.localeCompare(b.relative));
    return files;
  }
}
