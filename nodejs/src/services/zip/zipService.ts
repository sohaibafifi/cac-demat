import { mkdir, readdir, rename, rm } from 'fs/promises';
import path from 'path';
import { runCommand } from '../../utils/process.js';
import { isPipelineCancelledError, throwIfPipelineCancelled } from '../pipeline/pipelineCancelledError.js';
import type { PipelineLogger } from '../pdf/pdfPackageProcessor.js';

export interface ZipTarget {
  sourceDir: string;
  zipPath: string;
  label?: string;
}

export interface ZipOptions {
  logger?: PipelineLogger;
  abortSignal?: AbortSignal;
  removeSource?: boolean;
}

export interface ZipIssue {
  label: string;
  zipPath: string;
  message: string;
}

export interface ZipBatchResult {
  created: number;
  skipped: number;
  errors: ZipIssue[];
}

export class ZipService {
  async zipAll(targets: ZipTarget[], options: ZipOptions = {}): Promise<ZipBatchResult> {
    const summary: ZipBatchResult = {
      created: 0,
      skipped: 0,
      errors: [],
    };

    for (const target of targets) {
      throwIfPipelineCancelled(options.abortSignal);
      try {
        const created = await this.zipDirectory(target, options);
        if (created) {
          summary.created += 1;
        } else {
          summary.skipped += 1;
        }
      } catch (error) {
        if (isPipelineCancelledError(error)) {
          throw error;
        }

        const message = error instanceof Error ? error.message : String(error);
        summary.errors.push({
          label: target.label ?? path.basename(target.sourceDir),
          zipPath: target.zipPath,
          message,
        });
        options.logger?.(`Erreur lors de la création de l'archive pour ${target.label ?? target.sourceDir}: ${message}`);
      }
    }

    return summary;
  }

  private async zipDirectory(target: ZipTarget, options: ZipOptions): Promise<boolean> {
    const { sourceDir, zipPath, label } = target;
    throwIfPipelineCancelled(options.abortSignal);

    const hasFiles = await this.hasFiles(sourceDir, options.abortSignal);
    if (!hasFiles) {
      options.logger?.(`Aucun fichier à archiver pour ${label ?? sourceDir}. Archive ignorée.`);
      return false;
    }

    await mkdir(path.dirname(zipPath), { recursive: true, mode: 0o755 });

    const relativeToSource = path.relative(sourceDir, zipPath);
    const isInsideSource = relativeToSource && !relativeToSource.startsWith('..') && !path.isAbsolute(relativeToSource);
    const workingZipPath = isInsideSource
      ? path.join(path.dirname(sourceDir), path.basename(zipPath))
      : zipPath;

    await rm(zipPath, { force: true });
    if (workingZipPath !== zipPath) {
      await rm(workingZipPath, { force: true });
    }

    const cwd = path.dirname(sourceDir);
    const folderName = path.basename(sourceDir);

    const { command, args } = process.platform === 'win32'
      ? this.resolvePowershellCommand(folderName, workingZipPath)
      : this.resolveZipCommand(folderName, workingZipPath);

    const onOutput = (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) {
          options.logger?.(`[zip] ${trimmed}`);
        }
      }
    };

    let result;
    try {
      result = await runCommand(command, args, {
        cwd,
        onStdout: onOutput,
        onStderr: onOutput,
        abortSignal: options.abortSignal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Impossible de créer l'archive pour ${label ?? folderName}: ${message}`);
    }

    if (result.exitCode !== 0) {
      const error = result.stderr.trim() || result.stdout.trim();
      throw new Error(error || `Échec de la création de l'archive pour ${label ?? folderName}.`);
    }

    if (workingZipPath !== zipPath) {
      await mkdir(path.dirname(zipPath), { recursive: true, mode: 0o755 });
      await rm(zipPath, { force: true });
      await rename(workingZipPath, zipPath);
    }

    options.logger?.(`Archive générée pour ${label ?? folderName}: ${zipPath}`);

    if (options.removeSource) {
      // Only remove source if it's not the same directory as the zip file
      const zipDir = path.dirname(zipPath);
      const sourceDirResolved = path.resolve(sourceDir);
      const zipDirResolved = path.resolve(zipDir);

      if (sourceDirResolved !== zipDirResolved) {
        await rm(sourceDir, { recursive: true, force: true });
        options.logger?.(`Dossier source supprimé: ${sourceDir}`);
      }
    }

    return true;
  }

  private resolveZipCommand(folderName: string, zipPath: string): { command: string; args: string[] } {
    return {
      command: 'zip',
      args: ['-qr', zipPath, folderName],
    };
  }

  private resolvePowershellCommand(folderName: string, zipPath: string): { command: string; args: string[] } {
    const escapedFolder = folderName.replace(/'/g, "''");
    const escapedZip = zipPath.replace(/'/g, "''");
    const script = `Compress-Archive -Path '${escapedFolder}' -DestinationPath '${escapedZip}' -Force`;

    return {
      command: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-Command', script],
    };
  }

  private async hasFiles(dir: string, abortSignal?: AbortSignal): Promise<boolean> {
    throwIfPipelineCancelled(abortSignal);
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      throwIfPipelineCancelled(abortSignal);
      const fullPath = path.join(dir, entry.name);

      if (entry.isFile()) {
        return true;
      }

      if (entry.isDirectory()) {
        const nestedHasFiles = await this.hasFiles(fullPath, abortSignal);
        if (nestedHasFiles) {
          return true;
        }
      }
    }

    return false;
  }
}
