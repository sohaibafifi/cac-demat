import { CsvAssignmentLoader, MemberAssignment, ReviewerAssignment, PdfFileMatcher } from '../services/assignments/csvAssignmentLoader.js';
import { MemberPreparationService, MemberEntry } from '../services/pipeline/memberPreparationService.js';
import { ReviewerPreparationService, ReviewerPackage } from '../services/pipeline/reviewerPreparationService.js';
import { WorkspaceService, WorkspaceInventory } from '../services/workspace/workspaceService.js';
import type { PreparationStats } from '../services/pdf/pdfPackageProcessor.js';
import { ReviewerSummaryBuilder } from './reviewerSummaryBuilder.js';

export interface ManualReviewerAssignment {
  file: string;
  reviewers: string[];
  source: 'manual';
}

export interface ManualMemberEntry {
  name: string;
  files: string[];
  source: 'manual';
}

export interface ReviewerSummaryFile {
  name: string;
  missing: boolean;
  manual: boolean;
  manualIndex: number | null;
  source: 'csv' | 'manual';
  label?: string;
}

export interface ReviewerSummary {
  name: string;
  files: ReviewerSummaryFile[];
  hasManual: boolean;
  hasCsv: boolean;
  hasMissing: boolean;
}

export type RunMode = 'reviewers' | 'members';

export interface RunStats {
  runId: number;
  mode: RunMode;
  requested: number;
  recipients: number;
  files: number;
  missing: number;
  outputDir: string;
}

export class DashboardCoordinator {
  folder: string | null = null;
  csvReviewers: string | null = null;
  csvMembers: string | null = null;
  availableFiles: string[] = [];
  reviewersFromCsv: ReviewerAssignment[] = [];
  reviewersManual: ManualReviewerAssignment[] = [];
  membersFromCsv: MemberAssignment[] = [];
  membersManual: ManualMemberEntry[] = [];
  fileEntries: WorkspaceInventory['entries'] = [];
  missingReviewerFiles: string[] = [];
  missingReviewerNames: string[] = [];
  logMessages: string[] = ['Prêt.'];
  log = 'Prêt.';
  status = 'En attente';
  running = false;
  cacName = '';
  lastReviewerOutputDir: string | null = null;
  lastMemberOutputDir: string | null = null;
  lastRunMode: RunMode | null = null;
  lastRunStats: RunStats | null = null;
  private runCounter = 0;
  private readonly summaryBuilder = new ReviewerSummaryBuilder();

  constructor(
    private readonly csvLoader: CsvAssignmentLoader,
    private readonly workspace: WorkspaceService,
    private readonly reviewerService: ReviewerPreparationService,
    private readonly memberService: MemberPreparationService,
  ) {}

  async setFolder(folder: string): Promise<void> {
    this.folder = folder;
    await this.refreshAvailableFiles();
    this.appendLog(`Dossier sélectionné: ${folder}`);
  }

  async loadReviewersCsv(path: string): Promise<void> {
    this.csvReviewers = path;
    this.appendLog(`Fichier des rapporteurs sélectionné: ${path}`);

    try {
      this.reviewersFromCsv = await this.csvLoader.reviewers(path, this.availableFiles);
      this.appendLog('Attributions de rapporteurs importées.');
      await this.checkReviewerFileWarnings();
    } catch (error) {
      this.appendLog(`Échec de lecture du fichier des rapporteurs: ${this.getErrorMessage(error)}`);
    }
  }

  async loadMembersCsv(path: string): Promise<void> {
    this.csvMembers = path;
    this.appendLog(`Fichier des membres sélectionné: ${path}`);

    try {
      this.membersFromCsv = await this.csvLoader.members(path, this.availableFiles);
      this.appendLog('Membres importés.');
    } catch (error) {
      this.appendLog(`Échec de lecture du fichier des membres: ${this.getErrorMessage(error)}`);
    }
  }

  addManualReviewer(file: string, reviewerNames: string | string[]): void {
    const trimmedFile = file.trim();
    const reviewers = this.parseReviewerNames(reviewerNames);

    if (!trimmedFile || reviewers.length === 0) {
      this.appendLog('Veuillez renseigner un fichier et au moins un rapporteur.');
      return;
    }

    this.reviewersManual.push({ file: trimmedFile, reviewers, source: 'manual' });
    this.appendLog(`Attribution manuelle ajoutée pour ${trimmedFile}.`);

    if (trimmedFile.toLowerCase().endsWith('.pdf') && !this.availableFiles.includes(trimmedFile)) {
      this.availableFiles.push(trimmedFile);
      this.availableFiles.sort((a, b) => a.localeCompare(b));
    }

    void this.checkReviewerFileWarnings(false);
  }

  removeManualReviewer(index: number): void {
    const removed = this.reviewersManual[index];
    if (removed) {
      this.reviewersManual.splice(index, 1);
      this.appendLog(`Attribution manuelle supprimée: ${removed.file}`);
      void this.checkReviewerFileWarnings(false);
    }
  }

  addManualMember(name: string, filesRaw: string = ''): void {
    const trimmed = name.trim();
    if (!trimmed) {
      this.appendLog('Veuillez saisir un nom de membre.');
      return;
    }

    const files = this.normalizeMemberFiles(this.parseFileList(filesRaw));
    this.membersManual.push({ name: trimmed, files, source: 'manual' });
    this.appendLog(`Membre manuel ajouté: ${trimmed}`);
  }

  removeManualMember(index: number): void {
    const removed = this.membersManual[index];
    if (removed) {
      this.membersManual.splice(index, 1);
      this.appendLog(`Membre manuel supprimé: ${removed.name}`);
    }
  }

  getCanRunReviewers(): boolean {
    return !this.running && !!this.folder && this.reviewerPackages().length > 0 && !!this.cacName.trim();
  }

  getCanRunMembers(): boolean {
    return !this.running && !!this.folder && this.combinedMembers().length > 0 && !!this.cacName.trim();
  }

  setManualMemberFiles(index: number, files: string[]): void {
    if (index >= 0 && index < this.membersManual.length) {
      this.membersManual[index].files = this.normalizeMemberFiles(files);
    }
  }

  getReviewerSummaries(): ReviewerSummary[] {
    return this.summaryBuilder.build(this.reviewersFromCsv, this.reviewersManual, this.missingReviewerFiles);
  }

  reviewerPackages(): ReviewerPackage[] {
    return this.getReviewerSummaries()
      .map((summary) => {
        const files = Array.from(new Set(summary.files.map((f) => f.name.trim()).filter(Boolean)));
        return files.length > 0 ? { name: summary.name.trim(), files } : null;
      })
      .filter((entry): entry is ReviewerPackage => entry !== null);
  }

  combinedMembers(): MemberEntry[] {
    const combined = [
      ...this.membersFromCsv.map((entry) => ({
        name: entry.name,
        files: [...(entry.files ?? [])],
        source: entry.source,
      })),
      ...this.membersManual.map((entry) => ({
        name: entry.name,
        files: [...entry.files],
        source: entry.source,
      })),
    ];

    const seen = new Set<string>();
    const unique: MemberEntry[] = [];

    for (const entry of combined) {
      const key = entry.name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        unique.push({ name: entry.name, files: entry.files });
      }
    }

    return unique;
  }

  async runReviewers(): Promise<void> {
    if (this.running || !this.folder || this.reviewerPackages().length === 0 || !this.cacName.trim()) {
      return;
    }

    this.resetLog();
    this.appendLog('Initialisation du pipeline...');
    this.running = true;
    this.status = 'En cours...';

    try {
      const packages = this.reviewerPackages();
      const outputDir = await this.workspace.resolveOutputPath(this.folder, 'rapporteurs');

      this.lastReviewerOutputDir = outputDir;
      this.lastRunMode = 'reviewers';
      this.appendLog('Préparation des packages rapporteurs...');

      const stats = await this.reviewerService.prepare(
        packages,
        this.folder,
        outputDir,
        this.cacName,
        (message: string) => this.appendLog(message)
      );

      this.appendLog(`Dossier de sortie: ${outputDir}`);
      this.runCounter += 1;

      this.lastRunStats = {
        runId: this.runCounter,
        mode: 'reviewers',
        requested: stats.requestedRecipients,
        recipients: stats.processedRecipients,
        files: stats.processedFiles,
        missing: stats.missingFiles.length,
        outputDir,
      };

      const summary = `${stats.processedRecipients}/${stats.requestedRecipients} destinataire(s), ${stats.processedFiles} fichier(s) généré(s).`;
      this.appendLog(`Statistiques: ${summary}`);

      if (stats.missingFiles.length > 0) {
        this.appendLog(`⚠️ ${stats.missingFiles.length} fichier(s) introuvable(s) ignoré(s).`);
      }

      this.status = 'Terminé';
      this.appendLog('Pipeline terminé avec succès.');
    } catch (error) {
      this.status = 'Erreur';
      this.appendLog(`Erreur: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  async runMembers(): Promise<void> {
    if (this.running || !this.folder || this.combinedMembers().length === 0 || !this.cacName.trim()) {
      return;
    }

    this.resetLog();
    this.appendLog('Initialisation du pipeline...');
    this.running = true;
    this.status = 'En cours...';

    try {
      const entries = this.combinedMembers();
      const outputDir = await this.workspace.resolveOutputPath(this.folder, 'membres');

      this.lastMemberOutputDir = outputDir;
      this.lastRunMode = 'members';
      this.appendLog('Préparation des packages membres...');

      const stats = await this.memberService.prepare(
        entries,
        this.folder,
        outputDir,
        this.cacName,
        (message: string) => this.appendLog(message)
      );

      this.appendLog(`Dossier de sortie: ${outputDir}`);
      this.runCounter += 1;

      this.lastRunStats = {
        runId: this.runCounter,
        mode: 'members',
        requested: stats.requestedRecipients,
        recipients: stats.processedRecipients,
        files: stats.processedFiles,
        missing: stats.missingFiles.length,
        outputDir,
      };

      const summary = `${stats.processedRecipients}/${stats.requestedRecipients} destinataire(s), ${stats.processedFiles} fichier(s) généré(s).`;
      this.appendLog(`Statistiques: ${summary}`);

      if (stats.missingFiles.length > 0) {
        this.appendLog(`⚠️ ${stats.missingFiles.length} fichier(s) introuvable(s) ignoré(s).`);
      }

      this.status = 'Terminé';
      this.appendLog('Pipeline terminé avec succès.');
    } catch (error) {
      this.status = 'Erreur';
      this.appendLog(`Erreur: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  async executeRun(mode: RunMode): Promise<void> {
    if (mode === 'reviewers') {
      await this.runReviewers();
    } else {
      await this.runMembers();
    }
  }

  private async refreshAvailableFiles(): Promise<void> {
    if (!this.folder) {
      this.availableFiles = [];
      this.fileEntries = [];
      return;
    }

    const inventory = await this.workspace.inventory(this.folder);
    this.availableFiles = inventory.files.filter((file) => file.toLowerCase().endsWith('.pdf'));
    this.fileEntries = inventory.entries.filter(
      (entry) => entry.type === 'file' && entry.name.toLowerCase().endsWith('.pdf'),
    );

    if (this.csvReviewers) {
      try {
        this.reviewersFromCsv = await this.csvLoader.reviewers(this.csvReviewers, this.availableFiles);
      } catch (error) {
        this.appendLog(`Échec de relecture du fichier des rapporteurs: ${this.getErrorMessage(error)}`);
      }
    }

    if (this.csvMembers) {
      try {
        this.membersFromCsv = await this.csvLoader.members(this.csvMembers, this.availableFiles);
      } catch (error) {
        this.appendLog(`Échec de relecture du fichier des membres: ${this.getErrorMessage(error)}`);
      }
    }

    if (this.reviewersFromCsv.length > 0 || this.reviewersManual.length > 0) {
      await this.checkReviewerFileWarnings(false);
    }
  }

  private async checkReviewerFileWarnings(shouldLog = true): Promise<void> {
    const assignments = [...this.reviewersFromCsv, ...this.reviewersManual];
    const missing = this.workspace.findMissingFiles(assignments, this.availableFiles);
    const missingLabels = missing.map((file) => this.getAssignmentLabel(file));

    if (shouldLog) {
      for (const label of missingLabels) {
        this.appendLog(`⚠️ Fichier introuvable pour: ${this.formatDisplayLabel(label)}`);
      }
    }

    this.missingReviewerFiles = missing;
    this.missingReviewerNames = missingLabels.map((label) => this.formatDisplayLabel(label));
  }

  private parseReviewerNames(reviewerNames: string | string[]): string[] {
    if (Array.isArray(reviewerNames)) {
      return reviewerNames.map((n) => n.trim()).filter((n) => n);
    }
    return reviewerNames.split(/[,;\n]/).map((n) => n.trim()).filter((n) => n);
  }

  private parseFileList(filesRaw: string): string[] {
    return filesRaw.split(/[;,\n]/).map((f) => f.trim()).filter((f) => f);
  }

  private normalizeMemberFiles(files: string[]): string[] {
    if (!files || files.length === 0) {
      return [];
    }

    const matcher = this.createPdfMatcher();
    return files
      .map((file) => this.resolveMemberReference(file, matcher))
      .filter((file) => file.length > 0);
  }

  private resolveMemberReference(value: string, matcher: PdfFileMatcher | null): string {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }

    if (!matcher || !this.isNameReference(trimmed)) {
      return trimmed;
    }

    return matcher.findByNameReference(trimmed) ?? this.buildFallbackFileNameFromReference(trimmed);
  }

  private buildFallbackFileNameFromReference(reference: string): string {
    const normalized = reference.replace(/\s+/g, ' ').trim();
    return normalized === '' ? 'document.pdf' : `${normalized}.pdf`;
  }

  private isNameReference(value: string): boolean {
    if (!value) {
      return false;
    }

    const trimmed = value.trim();
    if (trimmed === '') {
      return false;
    }

    if (!trimmed.includes(' ')) {
      return false;
    }

    if (/[\\/]/.test(trimmed)) {
      return false;
    }

    if (/[*?]/.test(trimmed)) {
      return false;
    }

    if (/\./.test(trimmed)) {
      return false;
    }

    return true;
  }

  private createPdfMatcher(): PdfFileMatcher | null {
    return this.availableFiles.length > 0 ? new PdfFileMatcher(this.availableFiles) : null;
  }

  private resetLog(): void {
    this.logMessages = [];
    this.log = '';
  }

  private appendLog(message: string): void {
    this.logMessages.push(message);
    this.log = this.logMessages.join('\n');
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private getAssignmentLabel(file: string): string {
    const normalized = file.toLowerCase();

    const csvMatch = this.reviewersFromCsv.find(
      (assignment) => assignment.file.toLowerCase() === normalized,
    );
    if (csvMatch) {
      return csvMatch.label ?? csvMatch.file;
    }

    const manualMatch = this.reviewersManual.find(
      (assignment) => assignment.file.toLowerCase() === normalized,
    );
    if (manualMatch) {
      return manualMatch.file;
    }

    return file;
  }

  private formatDisplayLabel(value: string): string {
    const trimmed = value.replace(/\.pdf$/i, '').trim();
    return trimmed.length > 0 ? trimmed : value;
  }
}
