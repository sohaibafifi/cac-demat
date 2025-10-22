import { mkdir, stat } from 'fs/promises';
import path from 'path';
import { PdfProcessingContext } from '../../pdf/pdfProcessingContext.js';
import { PdfProcessingStage, PipelineLogger } from './contracts/pdfProcessingStage.js';
import { QpdfCommandResolver } from '../../pdf/qpdfCommandResolver.js';
import { PasswordGenerator } from '../../../support/security/passwordGenerator.js';
import { runCommand } from '../../../utils/process.js';

const ensureFile = async (candidate: string): Promise<void> => {
  const info = await stat(candidate);
  if (!info.isFile()) {
    throw new Error(`Fichier PDF introuvable: ${candidate}`);
  }
};

const streamLines = (logger: PipelineLogger | undefined, chunk: string): void => {
  if (!logger) {
    return;
  }

  for (const line of chunk.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed !== '') {
      logger(`[qpdf] ${trimmed}`);
    }
  }
};

export class RestrictionStage implements PdfProcessingStage {
  constructor(
    private readonly commandResolver: QpdfCommandResolver,
    private readonly passwordGenerator: PasswordGenerator,
  ) {}

  async process(context: PdfProcessingContext, logger?: PipelineLogger): Promise<PdfProcessingContext> {
    const finalPath = context.targetPath();
    const password = this.passwordGenerator.generate(12);

    await this.applyRestrictions(context.workingPath, finalPath, password, logger);

    if (context.useDefaultLogging) {
      this.log(logger, `Processed ${context.relativePath} for ${context.recipient} (owner password: ${password})`);
    }

    return context.withWorkingPath(finalPath, false).withPassword(password);
  }

  private async applyRestrictions(
    inputPath: string,
    outputPath: string,
    password: string,
    logger?: PipelineLogger,
  ): Promise<void> {
    await ensureFile(inputPath);

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
        '--print=none',
        '--extract=n',
        '--modify=none',
        '--',
        inputPath,
        outputPath,
      ],
      {
        onStdout: (chunk) => streamLines(logger, chunk),
        onStderr: (chunk) => streamLines(logger, chunk),
      },
    );

    if (result.exitCode !== 0) {
      const error = result.stderr.trim() || result.stdout.trim();
      throw new Error(error || 'Échec de l\'application des restrictions.');
    }
  }

  private log(logger: PipelineLogger | undefined, message: string): void {
    logger?.(message);
  }
}
