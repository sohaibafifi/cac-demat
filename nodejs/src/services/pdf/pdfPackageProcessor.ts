import { mkdir, readdir } from 'fs/promises';
import path from 'path';
import os from 'os';
import { PdfProcessingPipeline } from '../pipeline/pdfProcessingPipeline.js';
import { NameSanitizer } from '../../support/text/nameSanitizer.js';
import { PdfProcessingContext } from './pdfProcessingContext.js';
import { throwIfPipelineCancelled } from '../pipeline/pipelineCancelledError.js';

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

export interface PipelineProgress {
  total: number;
  completed: number;
  currentFile?: string | null;
  currentRecipient?: string | null;
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
    progress?: (progress: PipelineProgress) => void,
    abortSignal?: AbortSignal,
  ): Promise<PreparationStats> {
    throwIfPipelineCancelled(abortSignal);
    const entries = inventory ?? (await this.collectPdfFiles(resolvedSourceDir, abortSignal));
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
    const tasks: Array<() => Promise<void>> = [];
    const processedByRecipient = new Map<string, number>();
    const useDefaultLogging = !afterFileProcessed;
    let completed = 0;
    let totalTasks = 0;
    const throwIfCancelled = () => throwIfPipelineCancelled(abortSignal);

    for (const pkg of packages) {
      throwIfCancelled();
      const name = pkg.name.trim();
      if (!name) continue;

      const folderName = NameSanitizer.sanitize(name, sanitizeContext);
      const recipientDir = path.join(outputDir, folderName);
      await mkdir(recipientDir, { recursive: true, mode: 0o755 });

      const baseDir = collectionFolder ? path.join(recipientDir, collectionFolder) : recipientDir;
      await mkdir(baseDir, { recursive: true, mode: 0o755 });

      const files = pkg.files.map((f) => f.trim()).filter((f) => f);
      if (files.length === 0) continue;

      for (const relative of files) {
        throwIfCancelled();
        const file = lookup.get(relative.toLowerCase());

        if (!file) {
          logger?.(`Warning: Source file ${relative} not found. Skipping for ${name}.`);
          missing.add(relative);
          continue;
        }

        const destinationDir = file.relativeDir ? path.join(baseDir, file.relativeDir) : baseDir;
        const context = new PdfProcessingContext(
          file.path,
          file.relative,
          name,
          destinationDir,
          file.basename,
          { temporaryPaths: [], password: null, useDefaultLogging },
        );

        tasks.push(async () => {
          throwIfCancelled();
          await mkdir(destinationDir, { recursive: true, mode: 0o755 });
          const result = await this.pipeline.process(context, logger, abortSignal);
          stats.processedFiles += 1;

          const current = (processedByRecipient.get(name) ?? 0) + 1;
          processedByRecipient.set(name, current);

          if (afterFileProcessed) {
            await afterFileProcessed(file, name, true, result.password);
          } else if (!useDefaultLogging && result.password) {
            logger?.(`Processed ${file.relative} for ${name} (owner password: ${result.password})`);
          }

          completed += 1;
          progress?.({
            total: totalTasks,
            completed,
            currentFile: file.relative,
            currentRecipient: name,
          });
        });
      }
    }

    stats.missingFiles = Array.from(missing).sort((a, b) => a.localeCompare(b));

    totalTasks = tasks.length;
    if (totalTasks === 0) {
      progress?.({ total: 0, completed: 0 });
      return stats;
    }

    throwIfCancelled();
    progress?.({ total: totalTasks, completed: 0 });
    const concurrency = this.resolveConcurrency(totalTasks);

    try {
      await this.runConcurrently(tasks, concurrency, abortSignal);
    } finally {
      await this.pipeline.disposeSharedResources();
    }

    stats.processedRecipients = Array.from(processedByRecipient.values()).filter((count) => count > 0).length;
    progress?.({ total: totalTasks, completed: completed });
    return stats;
  }

  async collectPdfFiles(resolvedSourceDir: string, abortSignal?: AbortSignal): Promise<PdfInventoryEntry[]> {
    throwIfPipelineCancelled(abortSignal);
    const files: PdfInventoryEntry[] = [];

    const walk = async (current: string): Promise<void> => {
      throwIfPipelineCancelled(abortSignal);
      const entries = await readdir(current, { withFileTypes: true });

      for (const dirent of entries) {
        throwIfPipelineCancelled(abortSignal);
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

  private async runConcurrently(
    tasks: Array<() => Promise<void>>,
    concurrency: number,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    let index = 0;
    const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
    const throwIfCancelled = () => throwIfPipelineCancelled(abortSignal);
    
    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
      while (true) {
        throwIfCancelled();
        const current = index;
        if (current >= tasks.length) {
          break;
        }
        index += 1;
        await tasks[current]();
        // Yield to event loop periodically to allow IPC messages to be sent
        if (current % 2 === 0) {
          await yieldToEventLoop();
          throwIfCancelled();
        }
      }
    });

    await Promise.all(workers);
  }

  private resolveConcurrency(taskCount: number): number {
    const cpuCount = Math.max(1, os.cpus()?.length || 1);
    const preferred = cpuCount > 4 ? Math.min(cpuCount - 1, 6) : cpuCount;
    return Math.max(1, Math.min(taskCount, preferred));
  }
}
