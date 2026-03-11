import { mkdir, unlink } from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { PdfProcessingContext } from '../../pdf/pdfProcessingContext.js';
import { PdfProcessingStage, PipelineLogger } from './contracts/pdfProcessingStage.js';
import { throwIfPipelineCancelled } from '../pipelineCancelledError.js';
import { DocxConverter } from '../../conversion/docxConverter.js';

const DOCX_EXTENSIONS = ['.docx', '.doc', '.odt', '.rtf'];
const SUPPORTED_EXTENSIONS = ['.pdf', ...DOCX_EXTENSIONS];

const isDocumentFile = (filePath: string): boolean => {
  const ext = path.extname(filePath).toLowerCase();
  return DOCX_EXTENSIONS.includes(ext);
};

const isSupportedFile = (filename: string): boolean => {
  const ext = path.extname(filename).toLowerCase();
  return SUPPORTED_EXTENSIONS.includes(ext);
};

export class DocxConversionStage implements PdfProcessingStage {
  private readonly converter = new DocxConverter();

  async process(
    context: PdfProcessingContext,
    logger?: PipelineLogger,
    abortSignal?: AbortSignal,
  ): Promise<PdfProcessingContext> {
    throwIfPipelineCancelled(abortSignal);

    // Skip if not a document file (already a PDF)
    if (!isDocumentFile(context.workingPath)) {
      return context;
    }

    const pdfPath = await this.convertToPdf(context.workingPath, abortSignal);

    if (context.useDefaultLogging) {
      logger?.(`  → ${context.relativePath}: conversion DOCX → PDF effectuée`);
    }

    return context.withWorkingPath(pdfPath);
  }

  private async convertToPdf(sourcePath: string, abortSignal?: AbortSignal): Promise<string> {
    throwIfPipelineCancelled(abortSignal);

    const outputPath = path.join(os.tmpdir(), `cac_demat_converted_${randomUUID()}.pdf`);
    await mkdir(path.dirname(outputPath), { recursive: true });

    try {
      throwIfPipelineCancelled(abortSignal);
      await this.converter.convert(sourcePath, outputPath, abortSignal);
      return outputPath;
    } catch (error) {
      await unlink(outputPath).catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Échec de la conversion du document en PDF: ${message}`);
    }
  }
}

export { DOCX_EXTENSIONS, SUPPORTED_EXTENSIONS, isDocumentFile, isSupportedFile };
