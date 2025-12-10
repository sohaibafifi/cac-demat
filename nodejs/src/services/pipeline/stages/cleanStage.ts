import { access, readFile, writeFile, unlink, stat } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { PdfProcessingContext } from '../../pdf/pdfProcessingContext.js';
import { QpdfCommandResolver } from '../../pdf/qpdfCommandResolver.js';
import { PdfProcessingStage, PipelineLogger, SharedResourceStage } from './contracts/pdfProcessingStage.js';
import { runCommand } from '../../../utils/process.js';
import { throwIfPipelineCancelled } from '../pipelineCancelledError.js';

const fileExists = async (candidate: string): Promise<boolean> => {
  try {
    await access(candidate, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
};

type CleanCacheResult =
  | { type: 'unchanged' }
  | { type: 'cleaned'; path: string };

type CleanCacheEntry = {
  signature: string;
  result: Promise<CleanCacheResult>;
};

export class CleanStage implements PdfProcessingStage, SharedResourceStage {
  private readonly pattern = /\b\d{2}[ -]?[GPAEBSNIKT][ -]?\d{2}[ -]?\d{5}[ -]?[A-Z]{3}\b/g;
  private readonly splitPattern = /(\(\s*\d{2}\s*\))(-?\d+(?:\.\d+)?)(\(\s*[GPAEBSNIKT]\s*\))(-?\d+(?:\.\d+)?)(\(\s*\d{2}\s*\))(-?\d+(?:\.\d+)?)(\(\s*\d{5}\s*\))(-?\d+(?:\.\d+)?)(\(\s*[A-Z]{3}\s*\))/g;
  private readonly cache = new Map<string, CleanCacheEntry>();

  constructor(private readonly commandResolver: QpdfCommandResolver) {}

  async process(
    context: PdfProcessingContext,
    logger?: PipelineLogger,
    abortSignal?: AbortSignal,
  ): Promise<PdfProcessingContext> {
    throwIfPipelineCancelled(abortSignal);
    const sourcePath = context.workingPath;
    const signature = await this.buildSignature(sourcePath);
    const cached = this.cache.get(sourcePath);

    if (cached && cached.signature === signature) {
      const cachedResult = await cached.result;
      return this.applyResult(context, cachedResult);
    }

    if (cached && cached.signature !== signature) {
      void cached.result.then((result) => this.disposeResult(result)).catch(() => undefined);
    }

    const entry: CleanCacheEntry = {
      signature,
      result: this.prepareCleanArtifact(sourcePath, logger, abortSignal)
        .then((result) => {
          if (result.type === 'cleaned' && context.useDefaultLogging) {
            logger?.(`  → ${context.relativePath}: nettoyage des informations sensibles appliqué`);
          }
          return result;
        })
        .catch((error) => {
          this.cache.delete(sourcePath);
          throw error;
        }),
    };

    this.cache.set(sourcePath, entry);
    const result = await entry.result;
    return this.applyResult(context, result);
  }

  async disposeSharedResources(): Promise<void> {
    const entries = Array.from(this.cache.values());
    this.cache.clear();

    for (const entry of entries) {
      try {
        const result = await entry.result;
        await this.disposeResult(result);
      } catch {
        // ignore cleanup failures for cached results
      }
    }
  }

  private async buildSignature(pathname: string): Promise<string> {
    const stats = await stat(pathname);
    return `${stats.mtimeMs}-${stats.size}`;
  }

  private applyResult(context: PdfProcessingContext, result: CleanCacheResult): PdfProcessingContext {
    if (result.type === 'unchanged') {
      return context;
    }

    return context.withWorkingPath(result.path, false);
  }

  private async disposeResult(result: CleanCacheResult): Promise<void> {
    if (result.type === 'cleaned') {
      await unlink(result.path).catch(() => undefined);
    }
  }

  private async prepareCleanArtifact(
    sourcePath: string,
    logger: PipelineLogger | undefined,
    abortSignal?: AbortSignal,
  ): Promise<CleanCacheResult> {
    throwIfPipelineCancelled(abortSignal);
    const qdfPath = await this.convertToQdf(sourcePath, abortSignal);

    throwIfPipelineCancelled(abortSignal);

    if (!(await this.sanitizeQdf(qdfPath, logger, abortSignal))) {
      await unlink(qdfPath).catch(() => undefined);
      return { type: 'unchanged' };
    }

    try {
      const rebuiltPath = await this.rebuildPdf(qdfPath, abortSignal);
      await unlink(qdfPath).catch(() => undefined);
      return { type: 'cleaned', path: rebuiltPath };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.(`  ⚠️ Reconstruction qpdf échouée; utilisation du QDF nettoyé. Détail: ${message}`);
      return { type: 'cleaned', path: qdfPath };
    }
  }

  private async convertToQdf(sourcePath: string, abortSignal?: AbortSignal): Promise<string> {
    const command = await this.commandResolver.resolve();
    const qdfPath = path.join(os.tmpdir(), `cac_demat_qdf_${randomUUID()}.pdf`);

    const result = await runCommand(command, [
      '--warning-exit-0',
      '--stream-data=uncompress',
      '--object-streams=disable',
      '--qdf',
      sourcePath,
      qdfPath,
    ], { abortSignal });

    const success = result.exitCode === 0 && (await fileExists(qdfPath));
    if (!success) {
      await unlink(qdfPath).catch(() => undefined);
      const error = result.stderr.trim() || result.stdout.trim() || 'inconnue';
      throw new Error(`Impossible de générer la version QDF du PDF. Commande: ${command}. Erreur: ${error}`);
    }

    return qdfPath;
  }

  private async sanitizeQdf(
    pathname: string,
    logger: PipelineLogger | undefined,
    abortSignal?: AbortSignal,
  ): Promise<boolean> {
    throwIfPipelineCancelled(abortSignal);
    const buffer = await readFile(pathname);
    const source = buffer.toString('latin1');

    let count = 0;

    // Mask contiguous matches
    let sanitised = source.replace(this.pattern, (match) => {
      count += 1;
      logger?.(`    → Séquence masquée: ${match}`);
      return 'X'.repeat(match.length);
    });

    // Mask split matches
    sanitised = sanitised.replace(
      this.splitPattern,
      (_full, g1, g2, g3, g4, g5, g6, g7, g8, g9) => {
        count += 1;
        logger?.(`    → Séquence éclatée masquée: ${g1}${g2}${g3}${g4}${g5}${g6}${g7}${g8}${g9}`);

        const s1 = g1.replace(/\d/g, 'X');
        const s3 = g3.replace(/[A-Z]/gi, 'X');
        const s5 = g5.replace(/\d/g, 'X');
        const s7 = g7.replace(/\d/g, 'X');
        const s9 = g9.replace(/[A-Z]/gi, 'X');

        return `${s1}${g2}${s3}${g4}${s5}${g6}${s7}${g8}${s9}`;
      },
    );

    if (count === 0) return false;

    await writeFile(pathname, Buffer.from(sanitised, 'latin1'));
    logger?.(`    → ${count} occurrence(s) masquées`);

    return true;
  }

  private async rebuildPdf(qdfPath: string, abortSignal?: AbortSignal): Promise<string> {
    const command = await this.commandResolver.resolve();
    const rebuiltPath = path.join(os.tmpdir(), `cac_demat_clean_${randomUUID()}.pdf`);

    const result = await runCommand(command, ['--warning-exit-0', qdfPath, rebuiltPath], { abortSignal });
    const success = result.exitCode === 0 && (await fileExists(rebuiltPath));

    if (!success) {
      await unlink(rebuiltPath).catch(() => undefined);
      const error = result.stderr.trim() || result.stdout.trim() || 'inconnue';
      throw new Error(`Impossible de reconstruire le PDF nettoyé. Commande: ${command}. Erreur: ${error}`);
    }

    return rebuiltPath;
  }
}
