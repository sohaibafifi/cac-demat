import { mkdir, realpath } from 'fs/promises';
import path from 'path';
import {
  PdfPackageProcessor,
  PdfPackage,
  PdfInventoryEntry,
  PipelineLogger,
  PreparationStats,
  PipelineProgress,
  PreparationIssue,
} from '../pdf/pdfPackageProcessor.js';
import { NameSanitizer } from '../../support/text/nameSanitizer.js';
import { ZipService, ZipTarget } from '../zip/zipService.js';
import type { PdfRestrictionSelection, PipelineStageId } from './pipelineStages.js';
import { DocxTemplateService } from '../docx/docxTemplateService.js';
import { isPipelineCancelledError, throwIfPipelineCancelled } from './pipelineCancelledError.js';
import type { CandidateMetadata } from '../assignments/csvAssignmentLoader.js';

export interface ReviewerPackage {
  name: string;
  files: string[];
  candidateMetadata?: Record<string, CandidateMetadata>;
  reviewerNumberByFile?: Record<string, number>;
}

interface NormalizedReviewerPackage extends PdfPackage {
  candidateMetadata?: Record<string, CandidateMetadata>;
  reviewerNumberByFile?: Record<string, number>;
}

export class ReviewerPreparationService {
  constructor(
    private readonly packageProcessor: PdfPackageProcessor,
    private readonly zipService: ZipService,
    private readonly docxTemplateService: DocxTemplateService,
  ) {}

  async prepare(
    packages: ReviewerPackage[],
    sourceDir: string,
    outputDir: string,
    collectionName: string,
    logger?: PipelineLogger,
    progress?: (progress: PipelineProgress) => void,
    abortSignal?: AbortSignal,
    zipEnabled = true,
    activeStages?: readonly PipelineStageId[],
    restrictionOptions?: PdfRestrictionSelection,
    cacType: 'ripec' | 'avancement' | null = null,
  ): Promise<PreparationStats> {
    const resolvedSourceDir = await realpath(sourceDir);
    await mkdir(outputDir, { recursive: true, mode: 0o755 });

    const inventory = await this.packageProcessor.collectPdfFiles(resolvedSourceDir, abortSignal);

    const normalisedPackages: NormalizedReviewerPackage[] = packages
      .map((pkg) => ({
        name: pkg.name.trim(),
        files: pkg.files.map((f) => f.trim()).filter((f) => f),
        ...(pkg.candidateMetadata ? { candidateMetadata: { ...pkg.candidateMetadata } } : {}),
        ...(pkg.reviewerNumberByFile ? { reviewerNumberByFile: { ...pkg.reviewerNumberByFile } } : {}),
      }))
      .filter((pkg) => pkg.name && pkg.files.length > 0);

    if (normalisedPackages.length === 0) {
      return {
        requestedRecipients: packages.length,
        processedRecipients: 0,
        processedFiles: 0,
        missingFiles: [],
        errors: [],
      };
    }

    const zipTargets = zipEnabled
      ? this.buildZipTargets(normalisedPackages, outputDir, collectionName)
      : [];

    const stats = await this.packageProcessor.prepare(
      normalisedPackages,
      resolvedSourceDir,
      outputDir,
      'reviewer',
      collectionName,
      logger,
      inventory,
      async (file: PdfInventoryEntry, recipient: string, restricted: boolean, password: string | null) => {
        if (restricted) {
          logger?.((`Processed ${file.relative} for ${recipient} (owner password: ${password || ''})`));
        } else {
          logger?.((`Processed ${file.relative} for ${recipient} (sans restriction PDF)`));
        }
      },
      progress,
      abortSignal,
      activeStages,
      restrictionOptions,
    );

    if (cacType === 'ripec') {
      const issues = await this.addRipecReports(
        normalisedPackages,
        inventory,
        outputDir,
        collectionName,
        logger,
        abortSignal,
      );
      stats.errors.push(...issues);
    } else if (cacType === 'avancement') {
      const issues = await this.addAvancementReports(
        normalisedPackages,
        inventory,
        outputDir,
        collectionName,
        logger,
        abortSignal,
      );
      stats.errors.push(...issues);
    }

    if (zipTargets.length > 0 && zipEnabled) {
      const zipResult = await this.zipService.zipAll(zipTargets, { logger, abortSignal, removeSource: true });
      for (const issue of zipResult.errors) {
        stats.errors.push({
          recipient: issue.label,
          file: issue.zipPath,
          message: issue.message,
        });
      }
    }

    return stats;
  }

  private async addRipecReports(
    packages: NormalizedReviewerPackage[],
    inventory: PdfInventoryEntry[],
    outputDir: string,
    collectionName: string,
    logger?: PipelineLogger,
    abortSignal?: AbortSignal,
  ): Promise<PreparationIssue[]> {
    const errors: PreparationIssue[] = [];
    const lookup = new Map(inventory.map((file) => [file.relative.toLowerCase(), file]));
    const reviewerNumbersByFile = this.computeReviewerNumbersByFile(packages);

    for (const pkg of packages) {
      throwIfPipelineCancelled(abortSignal);
      const recipient = pkg.name.trim();
      if (!recipient) continue;

      const uniqueFiles = Array.from(new Set(pkg.files.map((file) => file.trim()).filter(Boolean)));
      for (const requestedFile of uniqueFiles) {
        throwIfPipelineCancelled(abortSignal);
        const file = lookup.get(requestedFile.toLowerCase());
        if (!file) {
          continue;
        }

        const reviewerNumber =
          this.resolvePackageReviewerNumber(pkg, file.relative) ??
          reviewerNumbersByFile.get(file.relative.toLowerCase())?.get(recipient) ??
          1;

        try {
          const baseDir = this.resolveRecipientBaseDir(recipient, outputDir, collectionName);
          const targetDirectory = file.relativeDir ? path.join(baseDir, file.relativeDir) : baseDir;
          const candidate = this.resolveCandidateMetadata(pkg, file);
          const targetName = this.resolveTargetName(file);
          const generated = await this.docxTemplateService.createRipecReport({
            targetName,
            reviewerName: recipient,
            reviewerNumber,
            candidate,
            targetDirectory,
          });

          const fileNames = generated.map((generatedPath) => path.basename(generatedPath)).join(', ');
          logger?.(`Documents RIPEC générés pour ${recipient} / ${targetName}: ${fileNames}`);
        } catch (error) {
          if (isPipelineCancelledError(error)) {
            throw error;
          }

          const message = error instanceof Error ? error.message : String(error);
          errors.push({
            recipient,
            file: file.relative,
            message,
          });
          logger?.(`Erreur lors de la génération des documents RIPEC pour ${recipient} / ${file.relative}: ${message}`);
        }
      }
    }

    return errors;
  }

  private async addAvancementReports(
    packages: NormalizedReviewerPackage[],
    inventory: PdfInventoryEntry[],
    outputDir: string,
    collectionName: string,
    logger?: PipelineLogger,
    abortSignal?: AbortSignal,
  ): Promise<PreparationIssue[]> {
    const errors: PreparationIssue[] = [];
    const lookup = new Map(inventory.map((file) => [file.relative.toLowerCase(), file]));
    const reviewerNumbersByFile = this.computeReviewerNumbersByFile(packages);

    for (const pkg of packages) {
      throwIfPipelineCancelled(abortSignal);
      const recipient = pkg.name.trim();
      if (!recipient) continue;

      const uniqueFiles = Array.from(new Set(pkg.files.map((file) => file.trim()).filter(Boolean)));
      for (const requestedFile of uniqueFiles) {
        throwIfPipelineCancelled(abortSignal);
        const file = lookup.get(requestedFile.toLowerCase());
        if (!file) {
          continue;
        }

        const reviewerNumber = reviewerNumbersByFile.get(file.relative.toLowerCase())?.get(recipient) ?? 1;

        try {
          const baseDir = this.resolveRecipientBaseDir(recipient, outputDir, collectionName);
          const targetDirectory = file.relativeDir ? path.join(baseDir, file.relativeDir) : baseDir;
          const candidate = this.resolveCandidateMetadata(pkg, file);
          const targetName = this.resolveTargetName(file);
          const generated = await this.docxTemplateService.createAvancementReports({
            targetName,
            reviewerName: recipient,
            reviewerNumber,
            candidate,
            targetDirectory,
          });

          const fileNames = generated.map((generatedPath) => path.basename(generatedPath)).join(', ');
          logger?.(`Documents Avancement générés pour ${recipient} / ${targetName}: ${fileNames}`);
        } catch (error) {
          if (isPipelineCancelledError(error)) {
            throw error;
          }

          const message = error instanceof Error ? error.message : String(error);
          errors.push({
            recipient,
            file: file.relative,
            message,
          });
          logger?.(`Erreur lors de la génération des documents Avancement pour ${recipient} / ${file.relative}: ${message}`);
        }
      }
    }

    return errors;
  }

  private computeReviewerNumbersByFile(
    packages: NormalizedReviewerPackage[],
  ): Map<string, Map<string, number>> {
    const result = new Map<string, Map<string, number>>();

    for (const pkg of packages) {
      const recipient = pkg.name.trim();
      if (!recipient) continue;

      const uniqueFiles = Array.from(new Set(pkg.files.map((file) => file.trim()).filter(Boolean)));
      for (const file of uniqueFiles) {
        const key = file.toLowerCase();
        let reviewerMap = result.get(key);
        if (!reviewerMap) {
          reviewerMap = new Map<string, number>();
          result.set(key, reviewerMap);
        }
        if (!reviewerMap.has(recipient)) {
          reviewerMap.set(recipient, reviewerMap.size + 1);
        }
      }
    }

    return result;
  }

  private resolvePackageReviewerNumber(
    pkg: NormalizedReviewerPackage,
    fileRelative: string,
  ): number | undefined {
    const map = pkg.reviewerNumberByFile;
    if (!map) return undefined;
    return map[fileRelative] ?? map[fileRelative.toLowerCase()];
  }

  private resolveTargetName(file: PdfInventoryEntry): string {
    const parsed = path.parse(file.basename);
    return parsed.name || file.basename;
  }

  private resolveCandidateMetadata(pkg: NormalizedReviewerPackage, file: PdfInventoryEntry): CandidateMetadata {
    const direct =
      pkg.candidateMetadata?.[file.relative] ??
      pkg.candidateMetadata?.[file.relative.toLowerCase()] ??
      pkg.candidateMetadata?.[file.basename] ??
      pkg.candidateMetadata?.[file.basename.toLowerCase()];

    return this.mergeCandidateMetadata(this.deriveCandidateMetadataFromFile(file), direct);
  }

  private deriveCandidateMetadataFromFile(file: PdfInventoryEntry): CandidateMetadata {
    const targetName = this.resolveTargetName(file)
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!targetName) {
      return {};
    }

    const parts = targetName.split(' ').filter(Boolean);
    if (parts.length < 2) {
      return { lastName: targetName };
    }

    return {
      lastName: parts[0],
      firstName: parts.slice(1).join(' '),
    };
  }

  private mergeCandidateMetadata(
    base: CandidateMetadata | undefined,
    next: CandidateMetadata | undefined,
  ): CandidateMetadata {
    return {
      ...(base ?? {}),
      ...Object.fromEntries(
        Object.entries(next ?? {}).filter(([, value]) => typeof value === 'string' && value.trim() !== ''),
      ),
    };
  }

  private resolveRecipientBaseDir(recipient: string, outputDir: string, collectionName: string): string {
    const folderName = NameSanitizer.sanitize(recipient, 'reviewer');
    const recipientDir = path.join(outputDir, folderName);
    const collectionFolder = collectionName.trim()
      ? NameSanitizer.sanitize(collectionName, 'collection')
      : null;

    return collectionFolder ? path.join(recipientDir, collectionFolder) : recipientDir;
  }

  private buildZipTargets(packages: PdfPackage[], outputDir: string, collectionName: string): ZipTarget[] {
    const uniqueTargets = new Map<string, ZipTarget>();
    const collectionLabel = NameSanitizer.sanitizeForFileName(collectionName, 'collection');

    for (const pkg of packages) {
      const recipient = pkg.name.trim();
      if (!recipient) continue;

      const folderName = NameSanitizer.sanitize(recipient, 'reviewer');
      const recipientDir = path.join(outputDir, folderName);
      const baseDir = this.resolveRecipientBaseDir(recipient, outputDir, collectionName);
      const zipName = `${collectionLabel} - ${NameSanitizer.sanitizeForFileName(recipient, 'destinataire')}.zip`;
      const zipPath = path.join(recipientDir, zipName);

      uniqueTargets.set(baseDir, { sourceDir: baseDir, zipPath, label: recipient });
    }

    return Array.from(uniqueTargets.values());
  }
}
