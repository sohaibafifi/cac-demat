import { copyFile, mkdir, unlink } from 'fs/promises';
import path from 'path';
import { PdfProcessingContext } from '../pdf/pdfProcessingContext.js';
import { PdfProcessingStage, PipelineLogger, SharedResourceStage } from './stages/contracts/pdfProcessingStage.js';
import { throwIfPipelineCancelled } from './pipelineCancelledError.js';
import type { PipelineStageId } from './pipelineStages.js';

const isSharedResourceStage = (
  stage: PdfProcessingStage | SharedResourceStage,
): stage is PdfProcessingStage & SharedResourceStage => {
  return 'disposeSharedResources' in stage && typeof stage.disposeSharedResources === 'function';
};

export interface PipelineStageRegistration {
  id?: PipelineStageId;
  stage: PdfProcessingStage;
}

export class PdfProcessingPipeline {
  constructor(private readonly stages: PipelineStageRegistration[]) {}

  async process(
    context: PdfProcessingContext,
    logger?: PipelineLogger,
    abortSignal?: AbortSignal,
    activeStageIds?: readonly PipelineStageId[],
  ): Promise<PdfProcessingContext> {
    let current = context;

    try {
      throwIfPipelineCancelled(abortSignal);

      for (const { stage } of this.resolveStages(activeStageIds)) {
        throwIfPipelineCancelled(abortSignal);
        current = await stage.process(current, logger, abortSignal);
      }

      throwIfPipelineCancelled(abortSignal);
      current = await this.finalize(current);
      return current;
    } finally {
      await this.cleanup(current);
    }
  }

  private resolveStages(activeStageIds?: readonly PipelineStageId[]): PipelineStageRegistration[] {
    if (!activeStageIds) {
      return this.stages;
    }

    const active = new Set(activeStageIds);
    return this.stages.filter((entry) => !entry.id || active.has(entry.id));
  }

  private async finalize(context: PdfProcessingContext): Promise<PdfProcessingContext> {
    const targetPath = context.targetPath();
    if (context.workingPath === targetPath) {
      return context;
    }

    await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o755 });
    await copyFile(context.workingPath, targetPath);
    return context.withWorkingPath(targetPath, false);
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
    for (const { stage } of this.stages) {
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
