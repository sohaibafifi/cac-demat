import { CsvAssignmentLoader, MemberAssignment, ReviewerAssignment } from '../services/assignments/csvAssignmentLoader.js';
import { MemberPreparationService, MemberEntry } from '../services/pipeline/memberPreparationService.js';
import { ReviewerPreparationService, ReviewerPackage } from '../services/pipeline/reviewerPreparationService.js';
import { WorkspaceService, WorkspaceInventory } from '../services/workspace/workspaceService.js';
import type { PreparationStats } from '../services/pdf/pdfPackageProcessor.js';

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
  logMessages: string[] = ['Prêt.'];
  log = 'Prêt.';
  status = 'En attente';
  running = false;
  manualReviewerFile = '';
  manualReviewerNames = '';
  manualMemberName = '';
  cacName = '';
  lastReviewerOutputDir: string | null = null;
  lastMemberOutputDir: string | null = null;
  lastRunMode: RunMode | null = null;
  lastRunStats: RunStats | null = null;
  private runCounter = 0;

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
    this.appendLog(`CSV des rapporteurs sélectionné: ${path}`);

    try {
      this.reviewersFromCsv = await this.csvLoader.reviewers(path);
      this.appendLog('Attributions de rapporteurs importées.');
      await this.checkReviewerFileWarnings();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.appendLog(`Échec de lecture du CSV des rapporteurs: ${message}`);
    }
  }

  async loadMembersCsv(path: string): Promise<void> {
    this.csvMembers = path;
    this.appendLog(`Fichier des membres sélectionné: ${path}`);

    try {
      this.membersFromCsv = await this.csvLoader.members(path);
      this.appendLog('Membres importés.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.appendLog(`Échec de lecture du fichier des membres: ${message}`);
    }
  }

  addManualReviewer(file: string, reviewerNames: string | string[]): void {
    const trimmedFile = file.trim();
    const names = Array.isArray(reviewerNames)
      ? reviewerNames
      : reviewerNames.split(/[,;\n]/);

    const reviewers = names
      .map((name) => name.trim())
      .filter((name) => name !== '');

    if (trimmedFile === '' || reviewers.length === 0) {
      this.appendLog('Veuillez renseigner un fichier et au moins un rapporteur.');
      return;
    }

    this.reviewersManual.push({
      file: trimmedFile,
      reviewers,
      source: 'manual',
    });

    this.appendLog(`Attribution manuelle ajoutée pour ${trimmedFile}.`);

    if (trimmedFile.toLowerCase().endsWith('.pdf') && !this.availableFiles.includes(trimmedFile)) {
      this.availableFiles.push(trimmedFile);
      this.availableFiles.sort((a, b) => a.localeCompare(b));
    }

    void this.checkReviewerFileWarnings(false);
  }

  removeManualReviewer(index: number): void {
    if (index < 0 || index >= this.reviewersManual.length) {
      return;
    }

    const [removed] = this.reviewersManual.splice(index, 1);
    if (removed) {
      this.appendLog(`Attribution manuelle supprimée: ${removed.file}`);
      void this.checkReviewerFileWarnings(false);
    }
  }

  addManualMember(name: string, filesRaw: string = ''): void {
    const trimmed = name.trim();
    if (trimmed === '') {
      this.appendLog('Veuillez saisir un nom de membre.');
      return;
    }
    const files = (filesRaw ?? '')
      .split(/[;,\n]/)
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');

    this.membersManual.push({ name: trimmed, files, source: 'manual' });
    this.appendLog(`Membre manuel ajouté: ${trimmed}`);
  }

  removeManualMember(index: number): void {
    if (index < 0 || index >= this.membersManual.length) {
      return;
    }

    const [removed] = this.membersManual.splice(index, 1);
    if (removed) {
      this.appendLog(`Membre manuel supprimé: ${removed.name}`);
    }
  }

  getCanRunReviewers(): boolean {
    return (
      !this.running
      && !!this.folder
      && this.reviewerPackages().length > 0
      && this.cacName.trim() !== ''
    );
  }

  getCanRunMembers(): boolean {
    return (
      !this.running
      && !!this.folder
      && this.combinedMembers().length > 0
      && this.cacName.trim() !== ''
    );
  }

  setManualMemberFiles(index: number, files: string[]): void {
    if (index < 0 || index >= this.membersManual.length) {
      return;
    }

    const cleaned = files
      .map((file) => file.trim())
      .filter((file) => file !== '');

    this.membersManual[index].files = cleaned;
  }

  getReviewerSummaries(): ReviewerSummary[] {
    const missingLookup = this.missingReviewerFiles.map((file) => file.toLowerCase());
    const grouped = new Map<string, ReviewerSummary>();

    const appendAssignment = (
      reviewer: string,
      file: string,
      source: 'csv' | 'manual',
      manualIndex: number | null,
    ) => {
      const reviewerName = reviewer.trim();
      if (reviewerName === '' || file === '') {
        return;
      }

      const normalisedReviewer = reviewerName.toLowerCase();
      if (!grouped.has(normalisedReviewer)) {
        grouped.set(normalisedReviewer, {
          name: reviewerName,
          files: [],
          hasManual: false,
          hasCsv: false,
          hasMissing: false,
        });
      }

      const summary = grouped.get(normalisedReviewer)!;
      const isMissing = missingLookup.includes(file.toLowerCase());

      summary.files.push({
        name: file,
        missing: isMissing,
        manual: source === 'manual',
        manualIndex,
        source,
      });

      if (source === 'manual') {
        summary.hasManual = true;
      }

      if (source === 'csv') {
        summary.hasCsv = true;
      }

      if (isMissing) {
        summary.hasMissing = true;
      }
    };

    this.reviewersFromCsv.forEach((assignment) => {
      const file = assignment.file.trim();
      if (file === '') {
        return;
      }

      assignment.reviewers
        .map((name) => name.trim())
        .filter((name) => name !== '')
        .forEach((name) => appendAssignment(name, file, 'csv', null));
    });

    this.reviewersManual.forEach((assignment, index) => {
      const file = assignment.file.trim();
      if (file === '') {
        return;
      }

      assignment.reviewers
        .map((name) => name.trim())
        .filter((name) => name !== '')
        .forEach((name) => appendAssignment(name, file, 'manual', index));
    });

    const summaries = Array.from(grouped.values());
    summaries.forEach((summary) => {
      summary.files.sort((a, b) => a.name.localeCompare(b.name));
    });

    summaries.sort((a, b) => a.name.localeCompare(b.name));
    return summaries;
  }

  reviewerPackages(): ReviewerPackage[] {
    return this.getReviewerSummaries()
      .map((summary) => {
        const name = summary.name.trim();
        const files = summary.files
          .map((entry) => entry.name.trim())
          .filter((entry) => entry !== '');

        if (name === '' || files.length === 0) {
          return null;
        }

        const uniqueFiles = Array.from(new Set(files));
        return { name, files: uniqueFiles };
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
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      unique.push({ name: entry.name, files: entry.files });
    }

    return unique;
  }

  async runReviewers(): Promise<void> {
    await this.executeRun('reviewers');
  }

  async runMembers(): Promise<void> {
    await this.executeRun('members');
  }

  async executeRun(mode: RunMode): Promise<void> {
    if (this.running) {
      return;
    }

    this.logMessages = [];
    this.log = '';
    this.appendLog('Initialisation du pipeline...');

    try {
      if (!this.folder) {
        throw new Error('Veuillez d\'abord sélectionner un dossier.');
      }

      const collectionName = this.cacName.trim();
      if (collectionName === '') {
        throw new Error('Veuillez saisir le nom du CAC.');
      }

      if (mode === 'reviewers') {
        if (this.reviewerPackages().length === 0) {
          throw new Error('Aucune attribution de rapporteur disponible.');
        }
      } else if (this.combinedMembers().length === 0) {
        throw new Error('Aucun membre disponible.');
      }

      this.running = true;
      this.status = 'En cours...';

      const logger = (message: string) => {
        this.appendLog(message);
      };

      if (mode === 'reviewers') {
        const packages = this.reviewerPackages();
        const outputDir = await this.workspace.resolveOutputPath(this.folder, 'rapporteurs');
        this.lastReviewerOutputDir = outputDir;
        this.lastRunMode = 'reviewers';
        this.appendLog('Préparation des packages rapporteurs...');
        const stats = await this.reviewerService.prepare(packages, this.folder, outputDir, collectionName, logger);
        this.appendLog(`Dossier de sortie: ${outputDir}`);
        this.applyRunStats('reviewers', outputDir, stats);
      } else {
        const entries = this.combinedMembers();
        const outputDir = await this.workspace.resolveOutputPath(this.folder, 'membres');
        this.lastMemberOutputDir = outputDir;
        this.lastRunMode = 'members';
        this.appendLog('Préparation des packages membres...');
        const stats = await this.memberService.prepare(entries, this.folder, outputDir, collectionName, logger);
        this.appendLog(`Dossier de sortie: ${outputDir}`);
        this.applyRunStats('members', outputDir, stats);
      }

      this.status = 'Terminé';
      this.appendLog('Pipeline terminé avec succès.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status = 'Erreur';
      this.appendLog(`Erreur: ${message}`);
    } finally {
      this.running = false;
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

    if (this.reviewersFromCsv.length > 0 || this.reviewersManual.length > 0) {
      await this.checkReviewerFileWarnings(false);
    }
  }

  private async checkReviewerFileWarnings(shouldLog = true): Promise<void> {
    const assignments = [...this.reviewersFromCsv, ...this.reviewersManual];
    const missing = this.workspace.findMissingFiles(assignments, this.availableFiles);

    if (shouldLog) {
      missing.forEach((file) => this.appendLog(`⚠️ Fichier introuvable dans le dossier: ${file}`));
    }

    this.missingReviewerFiles = missing;
  }

  private applyRunStats(mode: RunMode, outputDir: string, stats: PreparationStats): void {
    this.runCounter += 1;
    const requested = stats.requestedRecipients;
    const processed = stats.processedRecipients;
    const files = stats.processedFiles;
    const missing = stats.missingFiles.length;

    this.lastRunStats = {
      runId: this.runCounter,
      mode,
      requested,
      recipients: processed,
      files,
      missing,
      outputDir,
    };

    const summary = `${processed}/${requested} destinataire(s), ${files} fichier(s) généré(s).`;
    this.appendLog(`Statistiques: ${summary}`);
    if (missing > 0) {
      this.appendLog(`⚠️ ${missing} fichier(s) introuvable(s) ignoré(s).`);
    }
  }

  private appendLog(message: string): void {
    this.logMessages.push(message);
    this.log = this.logMessages.join('\n');
  }
}
