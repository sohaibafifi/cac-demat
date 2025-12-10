import { unlink } from 'fs/promises';
import { PdfProcessingContext } from '../pdf/pdfProcessingContext.js';
import { PdfProcessingStage, PipelineLogger, SharedResourceStage } from './stages/contracts/pdfProcessingStage.js';
import { throwIfPipelineCancelled } from './pipelineCancelledError.js';

const isSharedResourceStage = (
  stage: PdfProcessingStage | SharedResourceStage,
): stage is PdfProcessingStage & SharedResourceStage => {
  return 'disposeSharedResources' in stage && typeof stage.disposeSharedResources === 'function';
};

export class PdfProcessingPipeline {
  constructor(private readonly stages: PdfProcessingStage[]) {}

  async process(
    context: PdfProcessingContext,
    logger?: PipelineLogger,
    abortSignal?: AbortSignal,
  ): Promise<PdfProcessingContext> {
    let current = context;

    try {
      throwIfPipelineCancelled(abortSignal);

      for (const stage of this.stages) {
        throwIfPipelineCancelled(abortSignal);
        current = await stage.process(current, logger, abortSignal);
      }

      throwIfPipelineCancelled(abortSignal);
      return current;
    } finally {
      await this.cleanup(current);
    }
  }

  private async cleanup(context: PdfProcessingContext): Promise<void> {
    const finalPath = context.workingPath;

    for (const path of context.temporaryPaths) {
      if (!path || path === finalPath) {
        continue;
      }

      try {
        await unlink(path);
      } catch {
        // ignore cleanup errors
      }
    }
  }

  async disposeSharedResources(): Promise<void> {
    for (const stage of this.stages) {
      if (isSharedResourceStage(stage)) {
        try {
          await stage.disposeSharedResources();
        } catch {
          // ignore cleanup errors for shared resources
        }
      }
    }
  }
}
