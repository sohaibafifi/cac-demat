import { PdfProcessingContext } from '../../../pdf/pdfProcessingContext.js';

export type PipelineLogger = (message: string) => void;

export interface PdfProcessingStage {
  process(context: PdfProcessingContext, logger?: PipelineLogger): Promise<PdfProcessingContext>;
}

export interface SharedResourceStage {
  disposeSharedResources(): Promise<void>;
}
