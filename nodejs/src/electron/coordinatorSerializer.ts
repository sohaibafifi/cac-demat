import type { DashboardCoordinator } from '../app/dashboardCoordinator.js';
import type {
  PdfRestrictionOptionDefinition,
  PdfRestrictionSelection,
  PipelineStageDefinition,
  PipelineStageSelection,
} from '../services/pipeline/pipelineStages.js';

export interface SerializedCoordinatorState {
  folder: string | null;
  csvReviewers: string[];
  csvMembers: string[];
  availableFiles: string[];
  reviewersFromCsv: Array<{ file: string; reviewers: string[]; source: 'csv'; label?: string }>;
  reviewersManual: Array<{ file: string; reviewers: string[]; source: 'manual' }>;
  membersFromCsv: Array<{ name: string; files: string[]; source: 'csv' }>;
  membersManual: Array<{ name: string; files: string[]; source: 'manual' }>;
  fileEntries: Array<any>;
  missingReviewerFiles: string[];
  missingReviewerNames: string[];
  reviewerSummaries: Array<any>;
  combinedMembers: Array<{ name: string; files: string[] }>;
  log: string;
  runErrors: string[];
  status: string;
  running: boolean;
  cacName: string;
  cacType: 'avancement' | 'ripec';
  zipReviewersEnabled: boolean;
  zipMembersEnabled: boolean;
  pipelineStages: PipelineStageDefinition[];
  reviewerStageSelection: PipelineStageSelection;
  memberStageSelection: PipelineStageSelection;
  pdfRestrictionOptions: PdfRestrictionOptionDefinition[];
  reviewerRestrictionSelection: PdfRestrictionSelection;
  memberRestrictionSelection: PdfRestrictionSelection;
  canRunReviewers: boolean;
  canRunMembers: boolean;
  lastReviewerOutputDir: string | null;
  lastMemberOutputDir: string | null;
  lastRunMode: 'reviewers' | 'members' | null;
  lastRunStats: {
    runId: number;
    mode: 'reviewers' | 'members';
    requested: number;
    recipients: number;
    files: number;
    missing: number;
    errors: number;
    outputDir: string;
  } | null;
  progress: {
    active: boolean;
    total: number;
    completed: number;
    currentFile: string | null;
    currentRecipient: string | null;
    mode: 'reviewers' | 'members' | null;
  };
}

export function serializeCoordinatorState(coordinator: DashboardCoordinator): SerializedCoordinatorState {
  return {
    folder: coordinator.folder,
    csvReviewers: [...coordinator.csvReviewers],
    csvMembers: [...coordinator.csvMembers],
    availableFiles: [...coordinator.availableFiles],
    reviewersFromCsv: coordinator.reviewersFromCsv.map((entry) => ({
      file: entry.file,
      reviewers: [...entry.reviewers],
      source: entry.source,
      label: entry.label,
    })),
    reviewersManual: coordinator.reviewersManual.map((entry) => ({
      file: entry.file,
      reviewers: [...entry.reviewers],
      source: entry.source,
    })),
    membersFromCsv: coordinator.membersFromCsv.map((entry) => ({
      name: entry.name,
      files: [...(entry.files ?? [])],
      source: entry.source,
    })),
    membersManual: coordinator.membersManual.map((entry) => ({
      name: entry.name,
      files: [...entry.files],
      source: entry.source,
    })),
    fileEntries: coordinator.fileEntries.map((entry) => ({ ...entry })),
    missingReviewerFiles: [...coordinator.missingReviewerFiles],
    missingReviewerNames: [...coordinator.missingReviewerNames],
    reviewerSummaries: coordinator.getReviewerSummaries().map((summary) => ({
      name: summary.name,
      hasCsv: summary.hasCsv,
      hasManual: summary.hasManual,
      hasMissing: summary.hasMissing,
      files: summary.files.map((file) => ({
        name: file.name,
        missing: file.missing,
        manual: file.manual,
        manualIndex: file.manualIndex,
        source: file.source,
      })),
    })),
    combinedMembers: coordinator.combinedMembers().map((entry) => ({
      name: entry.name,
      files: [...(entry.files ?? [])],
    })),
    log: coordinator.log,
    runErrors: [...coordinator.runErrors],
    status: coordinator.status,
    running: coordinator.running,
    cacName: coordinator.cacName,
    cacType: coordinator.cacType,
    zipReviewersEnabled: coordinator.zipReviewersEnabled,
    zipMembersEnabled: coordinator.zipMembersEnabled,
    pipelineStages: coordinator.getPipelineStageDefinitions(),
    reviewerStageSelection: { ...coordinator.reviewerStageSelection },
    memberStageSelection: { ...coordinator.memberStageSelection },
    pdfRestrictionOptions: coordinator.getPdfRestrictionOptionDefinitions(),
    reviewerRestrictionSelection: { ...coordinator.reviewerRestrictionSelection },
    memberRestrictionSelection: { ...coordinator.memberRestrictionSelection },
    canRunReviewers: coordinator.getCanRunReviewers(),
    canRunMembers: coordinator.getCanRunMembers(),
    lastReviewerOutputDir: coordinator.lastReviewerOutputDir,
    lastMemberOutputDir: coordinator.lastMemberOutputDir,
    lastRunMode: coordinator.lastRunMode,
    lastRunStats: coordinator.lastRunStats
      ? {
          runId: coordinator.lastRunStats.runId,
          mode: coordinator.lastRunStats.mode,
          requested: coordinator.lastRunStats.requested,
          recipients: coordinator.lastRunStats.recipients,
          files: coordinator.lastRunStats.files,
          missing: coordinator.lastRunStats.missing,
          errors: coordinator.lastRunStats.errors,
          outputDir: coordinator.lastRunStats.outputDir,
        }
      : null,
    progress: {
      active: coordinator.progress.active,
      total: coordinator.progress.total,
      completed: coordinator.progress.completed,
      currentFile: coordinator.progress.currentFile,
      currentRecipient: coordinator.progress.currentRecipient,
      mode: coordinator.progress.mode,
    },
  };
}
