import { mkdir, readFile, stat, unlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { PdfProcessingContext } from '../../pdf/pdfProcessingContext.js';
import { PdfProcessingStage, PipelineLogger } from './contracts/pdfProcessingStage.js';
import { QpdfCommandResolver } from '../../pdf/qpdfCommandResolver.js';
import { runCommand } from '../../../utils/process.js';
import { throwIfPipelineCancelled } from '../pipelineCancelledError.js';

const escapePdfString = (value: string): string => {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
};

export class MetadataStage implements PdfProcessingStage {
  constructor(private readonly commandResolver: QpdfCommandResolver) {}

  async process(
    context: PdfProcessingContext,
    logger?: PipelineLogger,
    abortSignal?: AbortSignal,
  ): Promise<PdfProcessingContext> {
    throwIfPipelineCancelled(abortSignal);
    const qdfPath = await this.convertToQdf(context.workingPath, abortSignal);

    try {
      const updatedQdf = await this.applyMetadataPolicy(qdfPath, context.recipient, abortSignal);
      const rebuiltPath = await this.rebuildPdf(updatedQdf, abortSignal);

      if (context.useDefaultLogging) {
        logger?.(`  → ${context.relativePath}: métadonnées nettoyées et sujet appliqué`);
      }

      return context.withWorkingPath(rebuiltPath);
    } finally {
      await unlink(qdfPath).catch(() => undefined);
    }
  }

  private async convertToQdf(sourcePath: string, abortSignal?: AbortSignal): Promise<string> {
    const command = await this.commandResolver.resolve();
    const qdfPath = path.join(os.tmpdir(), `cac_demat_meta_qdf_${randomUUID()}.pdf`);

    const result = await runCommand(
      command,
      [
        '--warning-exit-0',
        '--stream-data=uncompress',
        '--object-streams=disable',
        '--remove-metadata',
        '--qdf',
        sourcePath,
        qdfPath,
      ],
      { abortSignal },
    );

    const exists = result.exitCode === 0 && (await this.fileExists(qdfPath));
    if (!exists) {
      await unlink(qdfPath).catch(() => undefined);
      const error = result.stderr.trim() || result.stdout.trim() || 'inconnue';
      throw new Error(`Impossible de préparer le QDF pour nettoyer les métadonnées. Commande: ${command}. Erreur: ${error}`);
    }

    return qdfPath;
  }

  private async applyMetadataPolicy(
    qdfPath: string,
    recipient: string,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    throwIfPipelineCancelled(abortSignal);
    const buffer = await readFile(qdfPath);
    const source = buffer.toString('latin1');
    const subject = this.buildSubject(recipient);
    const updated = this.injectInfoDictionary(source, subject);
    await writeFile(qdfPath, Buffer.from(updated, 'latin1'));
    return qdfPath;
  }

  private buildSubject(recipient: string): string {
    const label = recipient.trim().toUpperCase().normalize('NFD').replace(/\p{Diacritic}/gu, '') || 'WATERMARK';
    return `Shared with ${label}`;
  }

  private buildInfoDictionary(subject: string, existingBody?: string): string {
    const escapedSubject = escapePdfString(subject);
    let preserved: string[] = [];

    if (existingBody) {
      const cleaned = existingBody.replace(/\/(Author|Producer|Title|Subject)\s+\((?:\\.|[^\\)])*\)\s*/gi, '');
      preserved = cleaned
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    }

    const lines = ['<<'];
    for (const line of preserved) {
      lines.push(`  ${line}`);
    }
    lines.push(`  /Subject (${escapedSubject})`);
    lines.push('>>');
    return lines.join('\n');
  }

  private injectInfoDictionary(source: string, subject: string): string {
    const infoRefMatch = source.match(/\/Info\s+(\d+)\s+(\d+)\s+R/);
    const trailerMatch = source.match(/trailer\s*<<[\s\S]*?>>/);
    if (!trailerMatch) {
      throw new Error('Impossible de localiser le trailer PDF pour mettre à jour les métadonnées.');
    }

    const trailer = trailerMatch[0];
    const maxObjectId = this.findMaxObjectId(source);
    let updated = source;

    if (infoRefMatch) {
      const objectId = Number(infoRefMatch[1]);
      const generation = Number(infoRefMatch[2]);
      const objectPattern = new RegExp(
        `(?:\\r?\\n|^)${objectId}\\s+${generation}\\s+obj\\s*<<(.*?)>>\\s*endobj`,
        's',
      );
      const objectMatch = objectPattern.exec(updated);
      if (!objectMatch) {
        throw new Error('Impossible de localiser l\'objet Info dans le QDF.');
      }
      const dictionary = this.buildInfoDictionary(subject, objectMatch?.[1]);
      updated = updated.replace(objectPattern, `\n${objectId} ${generation} obj\n${dictionary}\nendobj`);
      updated = this.updateTrailer(updated, trailer, objectId, generation, maxObjectId);
      return updated;
    }

    const newId = maxObjectId + 1;
    const dictionary = this.buildInfoDictionary(subject);
    const infoObject = `\n${newId} 0 obj\n${dictionary}\nendobj\n`;
    const trailerIndex = updated.indexOf(trailer);

    if (trailerIndex === -1) {
      throw new Error('Impossible de préparer la section trailer pour mettre à jour les métadonnées.');
    }

    updated = `${updated.slice(0, trailerIndex)}${infoObject}${updated.slice(trailerIndex)}`;
    return this.updateTrailer(updated, trailer, newId, 0, newId);
  }

  private updateTrailer(
    source: string,
    trailer: string,
    infoId: number,
    generation: number,
    maxObjectId: number,
  ): string {
    let updatedTrailer = trailer;
    const infoPattern = /\/Info\s+\d+\s+\d+\s+R/;

    if (infoPattern.test(updatedTrailer)) {
      updatedTrailer = updatedTrailer.replace(infoPattern, `/Info ${infoId} ${generation} R`);
    } else {
      updatedTrailer = updatedTrailer.replace(/<<\s*/, (match) => `${match}/Info ${infoId} ${generation} R `);
    }

    updatedTrailer = updatedTrailer.replace(/\/Size\s+(\d+)/, (_match, value) => {
      const current = Number(value);
      const required = Math.max(current, maxObjectId + 1, infoId + 1);
      return `/Size ${required}`;
    });

    return source.replace(trailer, updatedTrailer);
  }

  private findMaxObjectId(source: string): number {
    let maxId = 0;
    const regex = /(?:^|\n)(\d+)\s+\d+\s+obj/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(source)) !== null) {
      const id = Number(match[1]);
      if (id > maxId) {
        maxId = id;
      }
    }

    return maxId;
  }

  private async rebuildPdf(qdfPath: string, abortSignal?: AbortSignal): Promise<string> {
    const command = await this.commandResolver.resolve();
    const outputPath = path.join(os.tmpdir(), `cac_demat_metadata_${randomUUID()}.pdf`);
    await mkdir(path.dirname(outputPath), { recursive: true });

    const result = await runCommand(command, ['--warning-exit-0', qdfPath, outputPath], { abortSignal });
    const success = result.exitCode === 0 && (await this.fileExists(outputPath));

    if (!success) {
      await unlink(outputPath).catch(() => undefined);
      const error = result.stderr.trim() || result.stdout.trim() || 'inconnue';
      throw new Error(`Impossible de reconstruire le PDF sans métadonnées. Commande: ${command}. Erreur: ${error}`);
    }

    return outputPath;
  }

  private async fileExists(pathname: string): Promise<boolean> {
    try {
      const stats = await stat(pathname);
      return stats.isFile();
    } catch {
      return false;
    }
  }
}
