import { mkdir } from 'fs/promises';
import path from 'path';
import { PdfProcessingContext } from '../../pdf/pdfProcessingContext.js';
import { PdfProcessingStage, PipelineLogger } from './contracts/pdfProcessingStage.js';
import { QpdfCommandResolver } from '../../pdf/qpdfCommandResolver.js';
import { PasswordGenerator } from '../../../support/security/passwordGenerator.js';
import { runCommand } from '../../../utils/process.js';
import { throwIfPipelineCancelled } from '../pipelineCancelledError.js';
import {
  createDefaultPdfRestrictionSelection,
  type PdfRestrictionSelection,
  type PipelineExecutionOptions,
} from '../pipelineStages.js';

export class RestrictionStage implements PdfProcessingStage {
  constructor(
    private readonly commandResolver: QpdfCommandResolver,
    private readonly passwordGenerator: PasswordGenerator,
  ) {}

  async process(
    context: PdfProcessingContext,
    logger?: PipelineLogger,
    abortSignal?: AbortSignal,
    options?: PipelineExecutionOptions,
  ): Promise<PdfProcessingContext> {
    throwIfPipelineCancelled(abortSignal);
    const finalPath = context.targetPath();
    const password = this.passwordGenerator.generate(12);
    const restrictionOptions = options?.restrictionOptions ?? createDefaultPdfRestrictionSelection();

    await this.applyRestrictions(context.workingPath, finalPath, password, restrictionOptions, logger, abortSignal);

    if (context.useDefaultLogging) {
      logger?.(
        `Processed ${context.relativePath} for ${context.recipient} (owner password: ${password}, restrictions: ${this.describeRestrictions(restrictionOptions)})`,
      );
    }

    return context.withWorkingPath(finalPath, false).withPassword(password);
  }

  private async applyRestrictions(
    inputPath: string,
    outputPath: string,
    password: string,
    restrictionOptions: PdfRestrictionSelection,
    logger?: PipelineLogger,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    throwIfPipelineCancelled(abortSignal);
    await mkdir(path.dirname(outputPath), { recursive: true });
    const command = await this.commandResolver.resolve();

    const result = await runCommand(
      command,
      [
        '--warning-exit-0',
        '--encrypt',
        '',
        password,
        '256',
        `--print=${restrictionOptions.print ? 'none' : 'full'}`,
        `--extract=${restrictionOptions.extract ? 'n' : 'y'}`,
        `--modify=${restrictionOptions.modify ? 'annotate' : 'all'}`,
        '--',
        inputPath,
        outputPath,
      ],
      {
        onStdout: (chunk) => {
          for (const line of chunk.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (trimmed) logger?.(`[qpdf] ${trimmed}`);
          }
        },
        onStderr: (chunk) => {
          for (const line of chunk.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (trimmed) logger?.(`[qpdf] ${trimmed}`);
          }
        },
        abortSignal,
      },
    );

    if (result.exitCode !== 0) {
      const error = result.stderr.trim() || result.stdout.trim();
      throw new Error(error || 'Échec de l\'application des restrictions.');
    }
  }

  private describeRestrictions(restrictionOptions: PdfRestrictionSelection): string {
    const active = [
      restrictionOptions.print ? 'impression interdite' : null,
      restrictionOptions.extract ? 'copie interdite' : null,
      restrictionOptions.modify ? 'modification limitée' : null,
    ].filter(Boolean);

    return active.length > 0 ? active.join(', ') : 'aucune permission bloquée';
  }
}
