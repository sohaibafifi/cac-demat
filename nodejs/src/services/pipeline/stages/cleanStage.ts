import { access, readFile, writeFile, unlink } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { PdfProcessingContext } from '../../pdf/pdfProcessingContext.js';
import { QpdfCommandResolver } from '../../pdf/qpdfCommandResolver.js';
import { PdfProcessingStage, PipelineLogger } from './contracts/pdfProcessingStage.js';
import { runCommand } from '../../../utils/process.js';

const fileExists = async (candidate: string): Promise<boolean> => {
  try {
    await access(candidate, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
};

export class CleanStage implements PdfProcessingStage {
  private readonly pattern = /\b\d{2}[ -]?[GPAEBSNIKT][ -]?\d{2}[ -]?\d{5}[ -]?[A-Z]{3}\b/g;
  private readonly splitPattern = /(\(\s*\d{2}\s*\))(-?\d+(?:\.\d+)?)(\(\s*[GPAEBSNIKT]\s*\))(-?\d+(?:\.\d+)?)(\(\s*\d{2}\s*\))(-?\d+(?:\.\d+)?)(\(\s*\d{5}\s*\))(-?\d+(?:\.\d+)?)(\(\s*[A-Z]{3}\s*\))/g;

  constructor(private readonly commandResolver: QpdfCommandResolver) {}

  async process(context: PdfProcessingContext, logger?: PipelineLogger): Promise<PdfProcessingContext> {
    const qdfPath = await this.convertToQdf(context.workingPath);

    if (!(await this.sanitizeQdf(qdfPath, logger))) {
      await this.safeUnlink(qdfPath);
      return context;
    }

    let updatedContext = context.withWorkingPath(qdfPath);
    try {
      const rebuiltPath = await this.rebuildPdf(qdfPath);

      if (updatedContext.useDefaultLogging) {
        this.log(logger, `  → ${updatedContext.relativePath}: nettoyage des informations sensibles appliqué`);
      }

      updatedContext = updatedContext.withWorkingPath(rebuiltPath, false);
      return updatedContext;
    } catch (error) {
      // When qpdf rebuild fails due to non‑fatal QDF inconsistencies, fall back to the
      // sanitized QDF directly. Later stages (watermark/restriction) will re‑emit a
      // proper PDF anyway.
      const message = error instanceof Error ? error.message : String(error);
      this.log(logger, `  ⚠️ Reconstruction qpdf échouée; utilisation du QDF nettoyé. Détail: ${message}`);
      return updatedContext.withWorkingPath(qdfPath, false);
    }
  }

  private async convertToQdf(sourcePath: string): Promise<string> {
    const command = await this.commandResolver.resolve();
    const qdfPath = path.join(os.tmpdir(), `cac_demat_qdf_${randomUUID()}.pdf`);

    const result = await runCommand(command, [
      '--warning-exit-0',
      '--stream-data=uncompress',
      '--object-streams=disable',
      '--qdf',
      sourcePath,
      qdfPath,
    ]);

    const success = result.exitCode === 0 && (await fileExists(qdfPath));
    if (!success) {
      await this.safeUnlink(qdfPath);
      const error = result.stderr.trim() || result.stdout.trim() || 'inconnue';
      throw new Error(
        `Impossible de générer la version QDF du PDF. Commande: ${command}. Erreur: ${error}`,
      );
    }

    return qdfPath;
  }

  private async sanitizeQdf(pathname: string, logger?: PipelineLogger): Promise<boolean> {
    // Read as binary and operate in latin1 to preserve byte-for-byte length.
    const buffer = await readFile(pathname);
    const source = buffer.toString('latin1');

    const counter = { count: 0 };
    let sanitised = this.maskContiguousMatches(source, counter, logger);
    sanitised = this.maskSplitMatches(sanitised, counter, logger);

    if (counter.count === 0) {
      return false;
    }

    const out = Buffer.from(sanitised, 'latin1');
    await writeFile(pathname, out);
    this.log(logger, `    → ${counter.count} occurrence(s) masquées`);

    return true;
  }

  private maskContiguousMatches(content: string, counter: { count: number }, logger?: PipelineLogger): string {
    return content.replace(this.pattern, (match) => {
      counter.count += 1;
      this.log(logger, `    → Séquence masquée: ${match}`);
      return 'X'.repeat(match.length);
    });
  }

  private maskSplitMatches(content: string, counter: { count: number }, logger?: PipelineLogger): string {
    return content.replace(
      this.splitPattern,
      (
        _full,
        g1,
        g2,
        g3,
        g4,
        g5,
        g6,
        g7,
        g8,
        g9,
      ) => {
        counter.count += 1;
        this.log(logger, `    → Séquence éclatée masquée: ${g1}${g2}${g3}${g4}${g5}${g6}${g7}${g8}${g9}`);

        const sanitized1 = g1.replace(/\d/g, 'X');
        const sanitized3 = g3.replace(/[A-Z]/gi, 'X');
        const sanitized5 = g5.replace(/\d/g, 'X');
        const sanitized7 = g7.replace(/\d/g, 'X');
        const sanitized9 = g9.replace(/[A-Z]/gi, 'X');

        return `${sanitized1}${g2}${sanitized3}${g4}${sanitized5}${g6}${sanitized7}${g8}${sanitized9}`;
      },
    );
  }

  private async rebuildPdf(qdfPath: string): Promise<string> {
    const command = await this.commandResolver.resolve();
    const rebuiltPath = path.join(os.tmpdir(), `cac_demat_clean_${randomUUID()}.pdf`);

    const result = await runCommand(command, [
      '--warning-exit-0',
      qdfPath,
      rebuiltPath,
    ]);
    const success = result.exitCode === 0 && (await fileExists(rebuiltPath));

    if (!success) {
      await this.safeUnlink(rebuiltPath);
      const error = result.stderr.trim() || result.stdout.trim() || 'inconnue';
      throw new Error(
        `Impossible de reconstruire le PDF nettoyé. Commande: ${command}. Erreur: ${error}`,
      );
    }

    return rebuiltPath;
  }

  private async safeUnlink(candidate: string): Promise<void> {
    if (!candidate) {
      return;
    }

    try {
      await unlink(candidate);
    } catch {
      // ignore cleanup errors
    }
  }

  private log(logger: PipelineLogger | undefined, message: string): void {
    logger?.(message);
  }
}
