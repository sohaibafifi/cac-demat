import { PdfProcessingContext } from '../../../pdf/pdfProcessingContext.js';
import type { PipelineExecutionOptions } from '../../pipelineStages.js';

export type PipelineLogger = (message: string) => void;

export interface PdfProcessingStage {
  process(
    context: PdfProcessingContext,
    logger?: PipelineLogger,
    abortSignal?: AbortSignal,
    options?: PipelineExecutionOptions,
  ): Promise<PdfProcessingContext>;
}

export interface SharedResourceStage {
  disposeSharedResources(): Promise<void>;
}
