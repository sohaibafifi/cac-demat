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
  ): Promise<void> {
    const entries = inventory ?? (await this.collectPdfFiles(resolvedSourceDir));
    const lookup = new Map<string, PdfInventoryEntry>();

    for (const entry of entries) {
      lookup.set(entry.relative.toLowerCase(), entry);
    }

    const trimmedCollection = collectionName.trim();
    const collectionFolder = trimmedCollection !== ''
      ? NameSanitizer.sanitize(trimmedCollection, 'collection')
      : null;

    for (const pkg of packages) {
      const name = pkg.name.trim();
      if (name === '') {
        continue;
      }

      const folderName = NameSanitizer.sanitize(name, sanitizeContext);
      const recipientDir = path.join(outputDir, folderName);
      await mkdir(recipientDir, { recursive: true, mode: 0o755 });

      const baseDir = collectionFolder ? path.join(recipientDir, collectionFolder) : recipientDir;
      await mkdir(baseDir, { recursive: true, mode: 0o755 });

      const files = pkg.files
        .map((file) => file.trim())
        .filter((file) => file !== '');

      if (files.length === 0) {
        continue;
      }

      const useDefaultLogging = !afterFileProcessed;

      for (const relative of files) {
        const key = relative.toLowerCase();
        const file = lookup.get(key);

        if (!file) {
          this.log(logger, `Warning: Source file ${relative} not found. Skipping for ${name}.`);
          continue;
        }

        const destinationDir = file.relativeDir === '' ? baseDir : path.join(baseDir, file.relativeDir);
        await mkdir(destinationDir, { recursive: true, mode: 0o755 });

        const context = new PdfProcessingContext(
          file.path,
          file.relative,
          name,
          destinationDir,
          file.basename,
          {
            temporaryPaths: [],
            password: null,
            useDefaultLogging,
          },
        );

        const result = await this.pipeline.process(context, logger);

        if (afterFileProcessed) {
          await afterFileProcessed(file, name, true, result.password);
        } else if (!useDefaultLogging && result.password) {
          this.log(logger, `Processed ${file.relative} for ${name} (owner password: ${result.password})`);
        }
      }
    }
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

        if (!dirent.isFile()) {
          continue;
        }

        if (!dirent.name.toLowerCase().endsWith('.pdf')) {
          continue;
        }

        const relative = path.relative(resolvedSourceDir, fullPath).split(path.sep).join('/');
        const relativeDir = path.dirname(relative) === '.' ? '' : path.dirname(relative).split(path.sep).join('/');

        files.push({
          path: fullPath,
          relative,
          relativeDir,
          basename: path.basename(fullPath),
        });
      }
    };

    await walk(resolvedSourceDir);
    files.sort((a, b) => a.relative.localeCompare(b.relative));
    return files;
  }

  private log(logger: PipelineLogger | undefined, message: string): void {
    logger?.(message);
  }
}
