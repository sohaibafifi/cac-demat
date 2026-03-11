import { mkdir, stat, unlink } from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { PdfProcessingContext } from '../../pdf/pdfProcessingContext.js';
import { PdfProcessingStage, PipelineLogger, SharedResourceStage } from './contracts/pdfProcessingStage.js';
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

export class DocxConversionStage implements PdfProcessingStage, SharedResourceStage {
  private readonly converter = new DocxConverter();
  private readonly cache = new Map<string, ConversionCacheEntry>();

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

    const result = await this.getConvertedPdf(context.workingPath, abortSignal);

    if (context.useDefaultLogging) {
      logger?.(`  → ${context.relativePath}: conversion DOCX → PDF effectuée`);
    }

    return context.withWorkingPath(result.path, false);
  }

  async disposeSharedResources(): Promise<void> {
    const entries = Array.from(this.cache.values());
    this.cache.clear();

    for (const entry of entries) {
      try {
        const result = await entry.result;
        await this.disposeResult(result);
      } catch {
        // ignore cleanup failures for cached conversions
      }
    }
  }

  private async getConvertedPdf(sourcePath: string, abortSignal?: AbortSignal): Promise<ConversionCacheResult> {
    throwIfPipelineCancelled(abortSignal);
    const signature = await this.buildSignature(sourcePath);
    const cached = this.cache.get(sourcePath);

    if (cached && cached.signature === signature) {
      return cached.result;
    }

    if (cached && cached.signature !== signature) {
      void cached.result.then((result) => this.disposeResult(result)).catch(() => undefined);
    }

    const entry: ConversionCacheEntry = {
      signature,
      result: this.convertToPdf(sourcePath, abortSignal)
        .then((path) => ({ path }))
        .catch((error) => {
          this.cache.delete(sourcePath);
          throw error;
        }),
    };

    this.cache.set(sourcePath, entry);
    return entry.result;
  }

  private async buildSignature(pathname: string): Promise<string> {
    const info = await stat(pathname);
    return `${info.mtimeMs}-${info.size}`;
  }

  private async disposeResult(result: ConversionCacheResult): Promise<void> {
    await unlink(result.path).catch(() => undefined);
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

type ConversionCacheResult = {
  path: string;
};

type ConversionCacheEntry = {
  signature: string;
  result: Promise<ConversionCacheResult>;
};

export { DOCX_EXTENSIONS, SUPPORTED_EXTENSIONS, isDocumentFile, isSupportedFile };
