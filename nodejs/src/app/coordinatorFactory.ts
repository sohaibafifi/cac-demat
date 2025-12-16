import { CsvAssignmentLoader } from '../services/assignments/csvAssignmentLoader.js';
import { MemberPreparationService } from '../services/pipeline/memberPreparationService.js';
import { ReviewerPreparationService } from '../services/pipeline/reviewerPreparationService.js';
import { PdfPackageProcessor } from '../services/pdf/pdfPackageProcessor.js';
import { PdfProcessingPipeline } from '../services/pipeline/pdfProcessingPipeline.js';
import { CleanStage } from '../services/pipeline/stages/cleanStage.js';
import { WatermarkStage } from '../services/pipeline/stages/watermarkStage.js';
import { RestrictionStage } from '../services/pipeline/stages/restrictionStage.js';
import { QpdfCommandResolver } from '../services/pdf/qpdfCommandResolver.js';
import { PasswordGenerator } from '../support/security/passwordGenerator.js';
import { DashboardCoordinator } from './dashboardCoordinator.js';
import { WorkspaceService } from '../services/workspace/workspaceService.js';
import { ZipService } from '../services/zip/zipService.js';

export function createCoordinator(): DashboardCoordinator {
  const resolver = new QpdfCommandResolver();
  const passwordGenerator = new PasswordGenerator();
  const zipService = new ZipService();

  const pipeline = new PdfProcessingPipeline([
    new CleanStage(resolver),
    new WatermarkStage(resolver),
    new RestrictionStage(resolver, passwordGenerator),
  ]);

  const packageProcessor = new PdfPackageProcessor(pipeline);
  const reviewerService = new ReviewerPreparationService(packageProcessor, zipService);
  const memberService = new MemberPreparationService(packageProcessor, zipService);
  const csvLoader = new CsvAssignmentLoader();
  const workspace = new WorkspaceService();

  return new DashboardCoordinator(csvLoader, workspace, reviewerService, memberService);
}
