import { mkdir, readFile, stat, unlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { PdfProcessingContext } from '../../pdf/pdfProcessingContext.js';
import { PdfProcessingStage, PipelineLogger } from './contracts/pdfProcessingStage.js';
import { QpdfCommandResolver } from '../../pdf/qpdfCommandResolver.js';
import { runCommand } from '../../../utils/process.js';
import { throwIfPipelineCancelled } from '../pipelineCancelledError.js';

const REMOVED_INFO_FIELDS = new Set(['/Author', '/Producer', '/Title', '/Subject']);

export class MetadataStage implements PdfProcessingStage {
  constructor(private readonly commandResolver: QpdfCommandResolver) {}

  async process(
    context: PdfProcessingContext,
    logger?: PipelineLogger,
    abortSignal?: AbortSignal,
  ): Promise<PdfProcessingContext> {
    throwIfPipelineCancelled(abortSignal);
    const jsonPath = await this.buildMetadataUpdateJson(context.workingPath, context.recipient, abortSignal);

    try {
      const rebuiltPath = await this.rebuildPdf(context.workingPath, jsonPath, abortSignal);

      if (context.useDefaultLogging) {
        logger?.(`  → ${context.relativePath}: métadonnées nettoyées et sujet appliqué`);
      }

      return context.withWorkingPath(rebuiltPath);
    } finally {
      await unlink(jsonPath).catch(() => undefined);
    }
  }

  private async buildMetadataUpdateJson(
    sourcePath: string,
    recipient: string,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const command = await this.commandResolver.resolve();
    const jsonPath = path.join(os.tmpdir(), `cac_demat_meta_${randomUUID()}.json`);

    const result = await runCommand(
      command,
      [
        sourcePath,
        '--json-output',
        jsonPath,
      ],
      { abortSignal },
    );

    const exists = result.exitCode === 0 && (await this.fileExists(jsonPath));
    if (!exists) {
      await unlink(jsonPath).catch(() => undefined);
      const error = result.stderr.trim() || result.stdout.trim() || 'inconnue';
      throw new Error(`Impossible de préparer la mise à jour JSON des métadonnées. Commande: ${command}. Erreur: ${error}`);
    }

    throwIfPipelineCancelled(abortSignal);
    const buffer = await readFile(jsonPath);
    const source = JSON.parse(buffer.toString('utf8'));
    const subject = this.buildSubject(recipient);
    const updated = this.injectInfoDictionary(source, subject);
    await writeFile(jsonPath, JSON.stringify(updated));
    return jsonPath;
  }

  private buildSubject(recipient: string): string {
    const label = recipient.trim().toUpperCase().normalize('NFD').replace(/\p{Diacritic}/gu, '') || 'WATERMARK';
    return `Shared with ${label}`;
  }

  private injectInfoDictionary(source: any, subject: string): any {
    const sections = Array.isArray(source?.qpdf) ? source.qpdf : null;
    const header = sections?.[0];
    const objects = sections?.[1];
    const trailer = objects?.trailer?.value;

    if (!header || !objects || !trailer || typeof trailer !== 'object') {
      throw new Error('Impossible d’analyser la structure JSON qpdf des métadonnées.');
    }

    let infoRef = typeof trailer['/Info'] === 'string' ? trailer['/Info'] : null;
    if (!infoRef) {
      const maxObjectId = Number(header.maxobjectid || 0);
      infoRef = `${maxObjectId + 1} 0 R`;
      trailer['/Info'] = infoRef;
    }

    const objectKey = `obj:${infoRef}`;
    const existingValue = objects?.[objectKey]?.value;
    const cleanedInfo: Record<string, unknown> = {};

    if (existingValue && typeof existingValue === 'object' && !Array.isArray(existingValue)) {
      for (const [key, value] of Object.entries(existingValue)) {
        if (!REMOVED_INFO_FIELDS.has(key)) {
          cleanedInfo[key] = value;
        }
      }
    }

    cleanedInfo['/Subject'] = `u:${subject}`;
    objects[objectKey] = { value: cleanedInfo };

    return source;
  }

  private async rebuildPdf(sourcePath: string, jsonPath: string, abortSignal?: AbortSignal): Promise<string> {
    const command = await this.commandResolver.resolve();
    const outputPath = path.join(os.tmpdir(), `cac_demat_metadata_${randomUUID()}.pdf`);
    await mkdir(path.dirname(outputPath), { recursive: true });

    const result = await runCommand(
      command,
      ['--warning-exit-0', '--remove-metadata', sourcePath, outputPath, `--update-from-json=${jsonPath}`],
      { abortSignal },
    );
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
