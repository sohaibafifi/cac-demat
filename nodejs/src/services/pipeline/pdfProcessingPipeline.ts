import { unlink } from 'fs/promises';
import { PdfProcessingContext } from '../pdf/pdfProcessingContext.js';
import { PdfProcessingStage, PipelineLogger } from './stages/contracts/pdfProcessingStage.js';

export class PdfProcessingPipeline {
  constructor(private readonly stages: PdfProcessingStage[]) {}

  async process(context: PdfProcessingContext, logger?: PipelineLogger): Promise<PdfProcessingContext> {
    let current = context;

    for (const stage of this.stages) {
      current = await stage.process(current, logger);
    }

    await this.cleanup(current);
    return current;
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
}
