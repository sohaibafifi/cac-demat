import { CsvAssignmentLoader } from '../services/assignments/csvAssignmentLoader.js';
import { MemberPreparationService } from '../services/pipeline/memberPreparationService.js';
import { ReviewerPreparationService } from '../services/pipeline/reviewerPreparationService.js';
import { PdfPackageProcessor } from '../services/pdf/pdfPackageProcessor.js';
import { PdfProcessingPipeline } from '../services/pipeline/pdfProcessingPipeline.js';
import { DocxConversionStage } from '../services/pipeline/stages/docxConversionStage.js';
import { CleanStage } from '../services/pipeline/stages/cleanStage.js';
import { MetadataStage } from '../services/pipeline/stages/metadataStage.js';
import { WatermarkStage } from '../services/pipeline/stages/watermarkStage.js';
import { RestrictionStage } from '../services/pipeline/stages/restrictionStage.js';
import { QpdfCommandResolver } from '../services/pdf/qpdfCommandResolver.js';
import { PasswordGenerator } from '../support/security/passwordGenerator.js';
import { DashboardCoordinator } from './dashboardCoordinator.js';
import { WorkspaceService } from '../services/workspace/workspaceService.js';
import { ZipService } from '../services/zip/zipService.js';
import { DocxTemplateService } from '../services/docx/docxTemplateService.js';

export function createCoordinator(): DashboardCoordinator {
  const resolver = new QpdfCommandResolver();
  const passwordGenerator = new PasswordGenerator();
  const zipService = new ZipService();
  const docxTemplateService = new DocxTemplateService();

  const pipeline = new PdfProcessingPipeline([
    { stage: new DocxConversionStage() },
    { id: 'clean', stage: new CleanStage(resolver) },
    { id: 'watermark', stage: new WatermarkStage(resolver) },
    { id: 'metadata', stage: new MetadataStage(resolver) },
    { id: 'restriction', stage: new RestrictionStage(resolver, passwordGenerator) },
  ]);

  const packageProcessor = new PdfPackageProcessor(pipeline);
  const reviewerService = new ReviewerPreparationService(packageProcessor, zipService, docxTemplateService);
  const memberService = new MemberPreparationService(packageProcessor, zipService);
  const csvLoader = new CsvAssignmentLoader();
  const workspace = new WorkspaceService();

  return new DashboardCoordinator(csvLoader, workspace, reviewerService, memberService);
}
