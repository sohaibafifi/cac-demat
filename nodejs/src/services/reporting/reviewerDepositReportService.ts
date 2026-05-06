import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'fs/promises';
import path from 'path';

type DepositMatchStatus = 'deposited' | 'probable' | 'missing';

interface ZipDirectoryCandidate {
  directory: string;
  zipFiles: string[];
}

interface ZipEntryInfo {
  name: string;
}

interface ExpectedReport {
  id: string;
  label: string;
  zipEntryName: string;
  sourceZip: string;
  normalized: string;
  tokens: string[];
}

interface DepositFile {
  name: string;
  path: string;
  size: number;
  modifiedAt: Date;
  modifiedAtLabel: string;
  relativeTimeLabel: string;
  normalized: string;
  tokens: string[];
}

interface MatchedReport {
  expected: ExpectedReport;
  deposit: DepositFile | null;
  status: DepositMatchStatus;
}

interface ReviewerReport {
  reviewerName: string;
  directory: string;
  zipNames: string[];
  expectedReports: ExpectedReport[];
  deposits: DepositFile[];
  matchedReports: MatchedReport[];
  unmatchedDeposits: DepositFile[];
  errors: string[];
  status: 'complete' | 'partial' | 'empty' | 'review';
  lastDeposit: DepositFile | null;
  exactCount: number;
  probableCount: number;
  missingCount: number;
}

interface ReviewerDepositReport {
  rootDir: string;
  generatedAt: Date;
  reviewerReports: ReviewerReport[];
  scanErrors: string[];
  directoriesWithoutZip: string[];
  directDirectoriesWithoutZip: number;
}

export interface ReviewerDepositReportSummary {
  reviewers: number;
  expectedReports: number;
  receivedReports: number;
  matchedReports: number;
  probableReports: number;
  missingReports: number;
  extraDeposits: number;
  unreadableZips: number;
  directDirectoriesWithoutZip: number;
}

export interface ReviewerDepositReportGenerationResult {
  rootDir: string;
  reportPath: string;
  generatedAt: string;
  summary: ReviewerDepositReportSummary;
}

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP64_SENTINEL = 0xffffffff;
const ZIP64_ENTRY_SENTINEL = 0xffff;
const MAX_ZIP_EOCD_SEARCH = 66_000;
const MAX_SCAN_DEPTH = 5;
const REPORT_EXTENSIONS = new Set(['.docx', '.pdf']);
const EXPECTED_PDF_EXTENSIONS = new Set(['.pdf']);
const RIPEC_REPORT_PREFIX = 'rapport ripec -';
const AVANCEMENT_REPORT_PREFIX = 'rapport avancement -';
const REPORT_PREFIXES = [RIPEC_REPORT_PREFIX, AVANCEMENT_REPORT_PREFIX];
const MATCH_STOP_WORDS = new Set([
  'avancement',
  'avis',
  'candidat',
  'candidate',
  'compte',
  'demat',
  'dossier',
  'dr',
  'madame',
  'monsieur',
  'pdf',
  'prenom',
  'rapport',
  'rapporteur',
  'rendu',
  'ripec',
]);

export class ReviewerDepositReportService {
  async generate(rootDir: string): Promise<ReviewerDepositReportGenerationResult> {
    const normalizedRoot = rootDir.trim();
    if (!normalizedRoot) {
      throw new Error('Dossier de reporting invalide.');
    }

    const resolvedRoot = await realpath(normalizedRoot);
    const report = await this.analyze(resolvedRoot);
    const html = this.renderHtml(report);
    const reportPath = path.join(resolvedRoot, this.createReportFileName(report.generatedAt));

    await mkdir(resolvedRoot, { recursive: true, mode: 0o755 });
    await writeFile(reportPath, html, 'utf8');

    return {
      rootDir: resolvedRoot,
      reportPath,
      generatedAt: report.generatedAt.toISOString(),
      summary: this.buildSummary(report),
    };
  }

  private async analyze(rootDir: string): Promise<ReviewerDepositReport> {
    const generatedAt = new Date();
    const scan = await this.findZipDirectories(rootDir);
    const reviewerReports: ReviewerReport[] = [];

    for (const candidate of scan.candidates) {
      reviewerReports.push(await this.analyzeReviewerDirectory(candidate, generatedAt));
    }

    reviewerReports.sort((a, b) => a.reviewerName.localeCompare(b.reviewerName, 'fr'));

    return {
      rootDir,
      generatedAt,
      reviewerReports,
      scanErrors: scan.errors,
      directoriesWithoutZip: scan.directoriesWithoutZip,
      directDirectoriesWithoutZip: scan.directoriesWithoutZip.length,
    };
  }

  private async findZipDirectories(rootDir: string): Promise<{
    candidates: ZipDirectoryCandidate[];
    errors: string[];
    directoriesWithoutZip: string[];
  }> {
    const candidates: ZipDirectoryCandidate[] = [];
    const errors: string[] = [];
    const directoriesWithoutZip: string[] = [];
    const seenDirectories = new Set<string>();

    const walk = async (currentDir: string, depth: number): Promise<boolean> => {
      let entries;
      try {
        entries = await readdir(currentDir, { withFileTypes: true });
      } catch (error) {
        errors.push(`Lecture impossible de ${currentDir}: ${this.formatError(error)}`);
        return false;
      }

      const zipFiles = entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.zip'))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b, 'fr'));
      let hasZipInTree = zipFiles.length > 0;

      if (zipFiles.length > 0 && !seenDirectories.has(currentDir)) {
        seenDirectories.add(currentDir);
        candidates.push({ directory: currentDir, zipFiles });
      }

      if (depth >= MAX_SCAN_DEPTH) {
        return hasZipInTree;
      }

      for (const entry of entries) {
        if (!entry.isDirectory() || this.shouldSkipDirectory(entry.name)) {
          continue;
        }

        const childDirectory = path.join(currentDir, entry.name);
        const childHasZip = await walk(childDirectory, depth + 1);
        if (depth === 0 && !childHasZip) {
          directoriesWithoutZip.push(childDirectory);
        }
        hasZipInTree = hasZipInTree || childHasZip;
      }

      return hasZipInTree;
    };

    await walk(rootDir, 0);

    candidates.sort((a, b) => a.directory.localeCompare(b.directory, 'fr'));
    directoriesWithoutZip.sort((a, b) => a.localeCompare(b, 'fr'));

    return {
      candidates,
      errors,
      directoriesWithoutZip,
    };
  }

  private async analyzeReviewerDirectory(candidate: ZipDirectoryCandidate, now: Date): Promise<ReviewerReport> {
    const reviewerName = this.resolveReviewerName(candidate);
    const errors: string[] = [];
    const expectedReports: ExpectedReport[] = [];
    const deposits = await this.collectDeposits(candidate.directory, now, errors);

    for (const zipName of candidate.zipFiles) {
      const zipPath = path.join(candidate.directory, zipName);

      try {
        const buffer = await readFile(zipPath);
        const entries = this.readZipEntries(buffer);
        expectedReports.push(...this.resolveExpectedReports(zipName, reviewerName, entries));
      } catch (error) {
        errors.push(`${zipName}: ${this.formatError(error)}`);
      }
    }

    const dedupedExpectedReports = this.dedupeExpectedReports(expectedReports);
    const matchResult = this.matchDeposits(dedupedExpectedReports, deposits);
    const matchedReports = matchResult.matches;
    const lastDeposit = this.resolveLastDeposit(deposits);
    const exactCount = matchedReports.filter((match) => match.status === 'deposited').length;
    const probableCount = matchedReports.filter((match) => match.status === 'probable').length;
    const missingCount = matchedReports.filter((match) => match.status === 'missing').length;

    return {
      reviewerName,
      directory: candidate.directory,
      zipNames: [...candidate.zipFiles],
      expectedReports: dedupedExpectedReports,
      deposits,
      matchedReports,
      unmatchedDeposits: matchResult.unmatchedDeposits,
      errors,
      status: this.resolveReviewerStatus(dedupedExpectedReports.length, deposits.length, missingCount, probableCount, matchResult.unmatchedDeposits.length, errors.length),
      lastDeposit,
      exactCount,
      probableCount,
      missingCount,
    };
  }

  private async collectDeposits(directory: string, now: Date, errors: string[]): Promise<DepositFile[]> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      errors.push(`Lecture des dépôts impossible: ${this.formatError(error)}`);
      return [];
    }

    const deposits: DepositFile[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !this.isReportDepositFile(entry.name)) {
        continue;
      }

      const filePath = path.join(directory, entry.name);
      try {
        const fileStat = await stat(filePath);
        const normalized = this.normalizeForMatch(entry.name);
        deposits.push({
          name: entry.name,
          path: filePath,
          size: fileStat.size,
          modifiedAt: fileStat.mtime,
          modifiedAtLabel: this.formatDateTime(fileStat.mtime),
          relativeTimeLabel: this.formatRelativeTime(fileStat.mtime, now),
          normalized,
          tokens: this.tokenize(entry.name),
        });
      } catch (error) {
        errors.push(`${entry.name}: date de dépôt indisponible (${this.formatError(error)})`);
      }
    }

    deposits.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return deposits;
  }

  private resolveExpectedReports(zipName: string, reviewerName: string, entries: ZipEntryInfo[]): ExpectedReport[] {
    const fileEntries = entries
      .map((entry) => entry.name)
      .filter((entryName) => this.isUsefulZipFileEntry(entryName));

    const ripecReports = fileEntries.filter((entryName) => this.isRipecReportEntry(entryName));
    const avancementReports = fileEntries.filter((entryName) => this.isAvancementReportEntry(entryName));
    const sourceEntries = ripecReports.length > 0
      ? ripecReports
      : avancementReports.length > 0
        ? avancementReports
        : fileEntries.filter((entryName) => EXPECTED_PDF_EXTENSIONS.has(path.posix.extname(entryName).toLowerCase()));

    return sourceEntries.map((entryName) => {
      const label = ripecReports.length > 0
        ? this.resolveRipecReportLabel(entryName, reviewerName)
        : avancementReports.length > 0
          ? this.resolveAvancementReportLabel(entryName, reviewerName)
          : this.resolveSourcePdfLabel(entryName);
      const normalized = this.normalizeForMatch(label);

      return {
        id: `${zipName}:${entryName}`,
        label,
        zipEntryName: entryName,
        sourceZip: zipName,
        normalized,
        tokens: this.tokenize(label),
      };
    });
  }

  private readZipEntries(buffer: Buffer): ZipEntryInfo[] {
    const eocdOffset = this.findEndOfCentralDirectory(buffer);
    const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
    const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
    const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);

    if (
      totalEntries === ZIP64_ENTRY_SENTINEL ||
      centralDirectoryOffset === ZIP64_SENTINEL ||
      centralDirectorySize === ZIP64_SENTINEL
    ) {
      throw new Error('ZIP64 non pris en charge pour le reporting.');
    }

    const entries: ZipEntryInfo[] = [];
    let offset = centralDirectoryOffset;
    const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;

    for (let index = 0; index < totalEntries; index += 1) {
      if (offset + 46 > buffer.length || offset >= centralDirectoryEnd) {
        throw new Error('Annuaire ZIP incomplet.');
      }

      const signature = buffer.readUInt32LE(offset);
      if (signature !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
        throw new Error('Annuaire ZIP invalide.');
      }

      const fileNameLength = buffer.readUInt16LE(offset + 28);
      const extraFieldLength = buffer.readUInt16LE(offset + 30);
      const fileCommentLength = buffer.readUInt16LE(offset + 32);
      const fileNameStart = offset + 46;
      const fileNameEnd = fileNameStart + fileNameLength;

      if (fileNameEnd > buffer.length) {
        throw new Error('Nom de fichier ZIP incomplet.');
      }

      entries.push({
        name: buffer.subarray(fileNameStart, fileNameEnd).toString('utf8'),
      });

      offset = fileNameEnd + extraFieldLength + fileCommentLength;
    }

    return entries;
  }

  private findEndOfCentralDirectory(buffer: Buffer): number {
    const searchStart = Math.max(0, buffer.length - MAX_ZIP_EOCD_SEARCH);

    for (let offset = buffer.length - 22; offset >= searchStart; offset -= 1) {
      if (buffer.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) {
        return offset;
      }
    }

    throw new Error('Fichier ZIP invalide ou incomplet.');
  }

  private matchDeposits(expectedReports: ExpectedReport[], deposits: DepositFile[]): {
    matches: MatchedReport[];
    unmatchedDeposits: DepositFile[];
  } {
    const matches: MatchedReport[] = expectedReports.map((expected) => ({
      expected,
      deposit: null,
      status: 'missing',
    }));

    const usedDeposits = new Set<number>();
    const scoredPairs: Array<{ expectedIndex: number; depositIndex: number; score: number }> = [];

    expectedReports.forEach((expected, expectedIndex) => {
      deposits.forEach((deposit, depositIndex) => {
        const score = this.scoreMatch(expected, deposit);
        if (score >= 0.55) {
          scoredPairs.push({ expectedIndex, depositIndex, score });
        }
      });
    });

    scoredPairs.sort((a, b) => b.score - a.score);

    for (const pair of scoredPairs) {
      if (matches[pair.expectedIndex].deposit || usedDeposits.has(pair.depositIndex)) {
        continue;
      }

      matches[pair.expectedIndex] = {
        expected: expectedReports[pair.expectedIndex],
        deposit: deposits[pair.depositIndex],
        status: 'deposited',
      };
      usedDeposits.add(pair.depositIndex);
    }

    const unmatchedExpectedIndexes = matches
      .map((match, index) => (match.deposit ? -1 : index))
      .filter((index) => index >= 0);
    const freeDepositIndexes = deposits
      .map((_deposit, index) => (usedDeposits.has(index) ? -1 : index))
      .filter((index) => index >= 0);

    const fallbackCount = Math.min(unmatchedExpectedIndexes.length, freeDepositIndexes.length);
    for (let index = 0; index < fallbackCount; index += 1) {
      const expectedIndex = unmatchedExpectedIndexes[index];
      const depositIndex = freeDepositIndexes[index];
      matches[expectedIndex] = {
        expected: expectedReports[expectedIndex],
        deposit: deposits[depositIndex],
        status: 'probable',
      };
      usedDeposits.add(depositIndex);
    }

    return {
      matches,
      unmatchedDeposits: deposits.filter((_deposit, index) => !usedDeposits.has(index)),
    };
  }

  private scoreMatch(expected: ExpectedReport, deposit: DepositFile): number {
    if (!expected.normalized || !deposit.normalized) {
      return 0;
    }

    if (expected.normalized === deposit.normalized) {
      return 1;
    }

    if (deposit.normalized.includes(expected.normalized) || expected.normalized.includes(deposit.normalized)) {
      return 0.95;
    }

    if (expected.tokens.length === 0 || deposit.tokens.length === 0) {
      return 0;
    }

    const expectedTokens = new Set(expected.tokens);
    const depositTokens = new Set(deposit.tokens);
    let intersection = 0;

    for (const token of expectedTokens) {
      if (depositTokens.has(token)) {
        intersection += 1;
      }
    }

    const expectedCoverage = intersection / expectedTokens.size;
    const depositCoverage = intersection / depositTokens.size;
    return Math.max(expectedCoverage, depositCoverage * 0.8);
  }

  private dedupeExpectedReports(expectedReports: ExpectedReport[]): ExpectedReport[] {
    const deduped = new Map<string, ExpectedReport>();

    for (const report of expectedReports) {
      const key = report.normalized || this.normalizeForMatch(report.zipEntryName);
      const existing = deduped.get(key);
      if (!existing) {
        deduped.set(key, report);
        continue;
      }

      deduped.set(key, {
        ...existing,
        sourceZip: existing.sourceZip === report.sourceZip
          ? existing.sourceZip
          : `${existing.sourceZip}, ${report.sourceZip}`,
      });
    }

    return Array.from(deduped.values()).sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  }

  private resolveReviewerName(candidate: ZipDirectoryCandidate): string {
    for (const zipName of candidate.zipFiles) {
      const parsed = path.parse(zipName).name.trim();
      const parts = parsed.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
      if (parts.length >= 2) {
        return parts[parts.length - 1];
      }
    }

    return path.basename(candidate.directory).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Rapporteur';
  }

  private resolveRipecReportLabel(entryName: string, reviewerName: string): string {
    const baseName = this.removeExtension(path.posix.basename(entryName));
    let label = baseName.replace(/^rapport\s+ripec\s*-\s*/i, '').trim() || baseName;
    const parts = label.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);

    if (parts.length >= 2 && this.normalizeForMatch(parts[parts.length - 1]) === this.normalizeForMatch(reviewerName)) {
      label = parts.slice(0, -1).join(' - ');
    }

    return this.cleanLabel(label);
  }

  private resolveAvancementReportLabel(entryName: string, reviewerName: string): string {
    const baseName = this.removeExtension(path.posix.basename(entryName));
    const trimmed = baseName.replace(/^rapport\s+avancement\s*-\s*/i, '').trim() || baseName;
    const parts = trimmed.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);

    if (parts.length === 0) {
      return this.cleanLabel(trimmed);
    }

    const last = parts[parts.length - 1];
    const isReviewer = this.normalizeForMatch(last) === this.normalizeForMatch(reviewerName);
    const isAnonymous = /^rapporteur\s*#?\s*\d+$/i.test(last);

    const target = (isReviewer || isAnonymous) && parts.length >= 2
      ? parts.slice(0, -1).join(' - ')
      : trimmed;
    const variant = isAnonymous ? ' (anonyme)' : isReviewer ? ' (nominatif)' : '';

    return `${this.cleanLabel(target)}${variant}`;
  }

  private resolveSourcePdfLabel(entryName: string): string {
    return this.cleanLabel(this.removeExtension(path.posix.basename(entryName)));
  }

  private cleanLabel(value: string): string {
    return value
      .replace(/[_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || value.trim();
  }

  private removeExtension(value: string): string {
    const extension = path.extname(value);
    return extension ? value.slice(0, -extension.length) : value;
  }

  private normalizeForMatch(value: string): string {
    return this.tokenize(value).join(' ');
  }

  private tokenize(value: string): string[] {
    let normalized = this.removeExtension(value)
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
    for (const prefix of REPORT_PREFIXES) {
      normalized = normalized.replace(prefix, ' ');
    }
    return normalized
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 1 && !MATCH_STOP_WORDS.has(token));
  }

  private isUsefulZipFileEntry(entryName: string): boolean {
    if (!entryName || entryName.endsWith('/')) {
      return false;
    }

    const parts = entryName.split('/');
    if (parts.some((part) => part === '__MACOSX' || part.startsWith('._'))) {
      return false;
    }

    const baseName = path.posix.basename(entryName);
    if (!baseName || baseName.startsWith('.') || baseName.startsWith('~$')) {
      return false;
    }

    const extension = path.posix.extname(baseName).toLowerCase();
    return extension === '.pdf' || extension === '.docx';
  }

  private isRipecReportEntry(entryName: string): boolean {
    const baseName = path.posix.basename(entryName).toLowerCase();
    return path.posix.extname(baseName) === '.docx' && baseName.startsWith(RIPEC_REPORT_PREFIX);
  }

  private isAvancementReportEntry(entryName: string): boolean {
    const baseName = path.posix.basename(entryName).toLowerCase();
    return path.posix.extname(baseName) === '.docx' && baseName.startsWith(AVANCEMENT_REPORT_PREFIX);
  }

  private isReportDepositFile(fileName: string): boolean {
    if (fileName.startsWith('.') || fileName.startsWith('._') || fileName.startsWith('~$')) {
      return false;
    }

    return REPORT_EXTENSIONS.has(path.extname(fileName).toLowerCase());
  }

  private shouldSkipDirectory(directoryName: string): boolean {
    return directoryName.startsWith('.') || directoryName === 'node_modules' || directoryName === '__MACOSX';
  }

  private resolveLastDeposit(deposits: DepositFile[]): DepositFile | null {
    return deposits.reduce<DepositFile | null>((latest, deposit) => {
      if (!latest || deposit.modifiedAt.getTime() > latest.modifiedAt.getTime()) {
        return deposit;
      }
      return latest;
    }, null);
  }

  private resolveReviewerStatus(
    expectedCount: number,
    depositCount: number,
    missingCount: number,
    probableCount: number,
    extraDepositCount: number,
    errorCount: number,
  ): ReviewerReport['status'] {
    if (expectedCount === 0 || errorCount > 0 || probableCount > 0 || extraDepositCount > 0) {
      return 'review';
    }

    if (depositCount === 0) {
      return 'empty';
    }

    return missingCount > 0 ? 'partial' : 'complete';
  }

  private buildSummary(report: ReviewerDepositReport): ReviewerDepositReportSummary {
    const expectedReports = report.reviewerReports.reduce((sum, reviewer) => sum + reviewer.expectedReports.length, 0);
    const matchedReports = report.reviewerReports.reduce((sum, reviewer) => sum + reviewer.exactCount, 0);
    const probableReports = report.reviewerReports.reduce((sum, reviewer) => sum + reviewer.probableCount, 0);
    const missingReports = report.reviewerReports.reduce((sum, reviewer) => sum + reviewer.missingCount, 0);
    const extraDeposits = report.reviewerReports.reduce((sum, reviewer) => sum + reviewer.unmatchedDeposits.length, 0);
    const unreadableZips = report.reviewerReports.reduce((sum, reviewer) => sum + reviewer.errors.length, 0) + report.scanErrors.length;

    return {
      reviewers: report.reviewerReports.length,
      expectedReports,
      receivedReports: matchedReports + probableReports,
      matchedReports,
      probableReports,
      missingReports,
      extraDeposits,
      unreadableZips,
      directDirectoriesWithoutZip: report.directDirectoriesWithoutZip,
    };
  }

  private renderHtml(report: ReviewerDepositReport): string {
    const summary = this.buildSummary(report);
    const generatedAtLabel = this.formatDateTime(report.generatedAt);
    const reviewerRows = report.reviewerReports.length > 0
      ? report.reviewerReports.map((reviewer) => this.renderReviewerSummaryRow(reviewer)).join('\n')
      : '<tr><td colspan="7" class="empty-cell">Aucun ZIP rapporteur trouvé dans le dossier analysé.</td></tr>';
    const detailBlocks = report.reviewerReports.length > 0
      ? report.reviewerReports.map((reviewer) => this.renderReviewerDetail(reviewer)).join('\n')
      : this.renderEmptyReport();
    const directoriesWithoutZip = report.directoriesWithoutZip.length > 0
      ? this.renderDirectoriesWithoutZip(report.rootDir, report.directoriesWithoutZip)
      : '';
    const scanErrors = report.scanErrors.length > 0
      ? `<section class="notice-block"><h2>Erreurs de scan</h2><ul>${report.scanErrors.map((error) => `<li>${this.escapeHtml(error)}</li>`).join('')}</ul></section>`
      : '';

    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Suivi des dépôts de rapports</title>
  <style>
    :root {
      color-scheme: light;
      --paper: #ffffff;
      --page: #f4f7f6;
      --ink: #1f2428;
      --muted: #5e6873;
      --line: #dce4e8;
      --accent: #0f6b6d;
      --accent-soft: #e7f3f1;
      --ok: #0f7b50;
      --ok-soft: #e6f4ed;
      --warn: #9a6500;
      --warn-soft: #fff5d8;
      --danger: #b42318;
      --danger-soft: #fde8e5;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--page);
      color: var(--ink);
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
    }
    .toolbar {
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      padding: 0.7rem 1rem;
      border-bottom: 1px solid var(--line);
      background: rgba(255,255,255,0.92);
      backdrop-filter: blur(8px);
    }
    button {
      border: 0;
      border-radius: 8px;
      padding: 0.55rem 0.9rem;
      background: var(--accent);
      color: #fff;
      font-weight: 700;
      cursor: pointer;
    }
    .report-shell {
      width: min(1160px, calc(100% - 32px));
      margin: 24px auto;
      padding: 28px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--paper);
      box-shadow: 0 20px 50px rgba(31, 36, 40, 0.08);
    }
    .report-header {
      display: grid;
      gap: 0.5rem;
      padding-bottom: 1.15rem;
      border-bottom: 3px solid var(--accent);
    }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 2rem; letter-spacing: 0; }
    h2 { margin-bottom: 0.75rem; font-size: 1.15rem; }
    h3 { font-size: 1rem; }
    .meta-line {
      color: var(--muted);
      overflow-wrap: anywhere;
    }
    .kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 0.75rem;
      margin: 1.25rem 0;
    }
    .kpi {
      padding: 0.85rem;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fbfdfd;
    }
    .kpi strong {
      display: block;
      font-size: 1.6rem;
      line-height: 1.1;
    }
    .kpi span {
      color: var(--muted);
      font-size: 0.86rem;
    }
    section, .reviewer-block {
      margin-top: 1.35rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    th, td {
      padding: 0.65rem 0.7rem;
      border: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
    }
    th {
      background: var(--accent-soft);
      color: #163235;
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    tbody tr:nth-child(even) {
      background: #fbfcfc;
    }
    small {
      display: block;
      margin-top: 0.12rem;
      color: var(--muted);
      font-size: 0.76rem;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 0.18rem 0.5rem;
      font-size: 0.74rem;
      font-weight: 800;
      white-space: nowrap;
    }
    .status-complete, .status-deposited { background: var(--ok-soft); color: var(--ok); }
    .status-review, .status-probable { background: var(--warn-soft); color: var(--warn); }
    .status-partial, .status-empty, .status-missing { background: var(--danger-soft); color: var(--danger); }
    .reviewer-block {
      padding-top: 1rem;
      border-top: 1px solid var(--line);
      break-inside: avoid;
    }
    .reviewer-head {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      align-items: flex-start;
      margin-bottom: 0.7rem;
    }
    .file-list {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      margin-top: 0.4rem;
    }
    .file-chip {
      border-radius: 999px;
      padding: 0.16rem 0.5rem;
      border: 1px solid var(--line);
      background: #fff;
      font-size: 0.76rem;
      overflow-wrap: anywhere;
    }
    .file-chip-missing {
      border-color: rgba(180, 35, 24, 0.28);
      background: var(--danger-soft);
      color: var(--danger);
    }
    .file-chip-deposited {
      border-color: rgba(15, 123, 80, 0.28);
      background: var(--ok-soft);
      color: var(--ok);
    }
    .notice-block {
      padding: 0.8rem;
      border: 1px solid var(--warn);
      border-radius: 8px;
      background: var(--warn-soft);
    }
    .notice-block ul {
      margin: 0.5rem 0 0;
      padding-left: 1.2rem;
    }
    .missing-block {
      border-color: rgba(180, 35, 24, 0.5);
      background: var(--danger-soft);
    }
    .empty-cell, .empty-state {
      color: var(--muted);
      text-align: center;
    }
    .empty-state {
      padding: 2rem 1rem;
      border: 1px dashed var(--line);
      border-radius: 8px;
    }
    @page { margin: 12mm; }
    @media print {
      body { background: #fff; }
      .no-print { display: none !important; }
      .report-shell {
        width: auto;
        margin: 0;
        padding: 0;
        border: 0;
        box-shadow: none;
      }
      .kpi, th, td, .reviewer-block, .notice-block {
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }
      .reviewer-block {
        break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="toolbar no-print">
    <button type="button" onclick="window.print()">Imprimer ou enregistrer en PDF</button>
  </div>
  <main class="report-shell">
    <header class="report-header">
      <h1>Suivi des dépôts de rapports</h1>
      <p class="meta-line">Dossier analysé : ${this.escapeHtml(report.rootDir)}</p>
      <p class="meta-line">Généré le ${this.escapeHtml(generatedAtLabel)}</p>
    </header>

    <section class="kpis" aria-label="Synthèse">
      ${this.renderKpi(summary.reviewers, 'rapporteurs détectés')}
      ${this.renderKpi(summary.expectedReports, 'rapports attendus')}
      ${this.renderKpi(summary.receivedReports, 'dépôts rattachés')}
      ${this.renderKpi(summary.missingReports, 'rapports manquants')}
      ${this.renderKpi(summary.probableReports, 'dépôts à vérifier')}
      ${this.renderKpi(summary.extraDeposits, 'dépôts non rattachés')}
      ${this.renderKpi(summary.directDirectoriesWithoutZip, 'dossiers sans ZIP')}
    </section>

    ${directoriesWithoutZip}

    <section>
      <h2>Synthèse par rapporteur</h2>
      <table>
        <thead>
          <tr>
            <th>Rapporteur</th>
            <th>Statut</th>
            <th>Attendus</th>
            <th>Déposés</th>
            <th>À vérifier</th>
            <th>Manquants</th>
            <th>Dernier dépôt</th>
          </tr>
        </thead>
        <tbody>
          ${reviewerRows}
        </tbody>
      </table>
    </section>

    <section>
      <h2>Détails des dépôts</h2>
      ${detailBlocks}
    </section>

    ${scanErrors}
  </main>
</body>
</html>`;
  }

  private renderReviewerSummaryRow(reviewer: ReviewerReport): string {
    return `<tr>
      <td><strong>${this.escapeHtml(reviewer.reviewerName)}</strong><small>${this.escapeHtml(this.relativePathLabel(reviewer.directory))}</small></td>
      <td>${this.renderReviewerStatus(reviewer.status)}</td>
      <td>${reviewer.expectedReports.length}</td>
      <td>${this.renderDepositedReportsCell(reviewer)}</td>
      <td>${reviewer.probableCount + reviewer.unmatchedDeposits.length}</td>
      <td>${this.renderMissingReportsCell(reviewer)}</td>
      <td>${this.renderDepositDate(reviewer.lastDeposit)}</td>
    </tr>`;
  }

  private renderDepositedReportsCell(reviewer: ReviewerReport): string {
    const deposited = this.resolveDepositedMatches(reviewer);
    if (deposited.length === 0) {
      return '0';
    }

    const visible = deposited.slice(0, 4);
    const hiddenCount = deposited.length - visible.length;
    const labels = visible
      .map((match) => `<span class="file-chip file-chip-deposited">${this.escapeHtml(match.expected.label)}</span>`)
      .join('');
    const more = hiddenCount > 0
      ? `<span class="file-chip file-chip-deposited">+${hiddenCount} autre(s)</span>`
      : '';

    return `<strong>${deposited.length}</strong><div class="file-list">${labels}${more}</div>`;
  }

  private renderMissingReportsCell(reviewer: ReviewerReport): string {
    const missing = this.resolveMissingMatches(reviewer);
    if (missing.length === 0) {
      return '0';
    }

    const visible = missing.slice(0, 4);
    const hiddenCount = missing.length - visible.length;
    const labels = visible
      .map((match) => `<span class="file-chip file-chip-missing">${this.escapeHtml(match.expected.label)}</span>`)
      .join('');
    const more = hiddenCount > 0
      ? `<span class="file-chip file-chip-missing">+${hiddenCount} autre(s)</span>`
      : '';

    return `<strong>${missing.length}</strong><div class="file-list">${labels}${more}</div>`;
  }

  private renderDirectoriesWithoutZip(rootDir: string, directories: string[]): string {
    return `<section class="notice-block">
      <h2>Dossiers sans ZIP rapporteur</h2>
      <p>Ces répertoires directs ne contiennent aucun ZIP rapporteur dans leur arborescence analysée.</p>
      <ul>${directories.map((directory) => `<li>${this.escapeHtml(this.formatDirectoryRelativeToRoot(rootDir, directory))}</li>`).join('')}</ul>
    </section>`;
  }

  private renderReviewerDetail(reviewer: ReviewerReport): string {
    const missingReports = this.renderMissingReportsBlock(reviewer);
    const rows = reviewer.matchedReports.length > 0
      ? reviewer.matchedReports.map((match) => `<tr>
          <td><strong>${this.escapeHtml(match.expected.label)}</strong>${this.renderExpectedSourceDetails(match.expected)}</td>
          <td>${match.deposit ? this.renderDepositFile(match.deposit) : '<span class="status-pill status-missing">Non déposé</span>'}</td>
          <td>${match.deposit ? this.renderDepositDate(match.deposit) : '-'}</td>
          <td>${this.renderMatchStatus(match.status)}</td>
        </tr>`).join('\n')
      : '<tr><td colspan="4" class="empty-cell">Aucun rapport attendu n’a pu être déduit des ZIP.</td></tr>';
    const unmatchedDeposits = reviewer.unmatchedDeposits.length > 0
      ? `<div class="file-list">${reviewer.unmatchedDeposits.map((deposit) => `<span class="file-chip">${this.escapeHtml(deposit.name)} · ${this.escapeHtml(deposit.modifiedAtLabel)} (${this.escapeHtml(deposit.relativeTimeLabel)})</span>`).join('')}</div>`
      : '';
    const errors = reviewer.errors.length > 0
      ? `<div class="notice-block"><h3>Points à vérifier</h3><ul>${reviewer.errors.map((error) => `<li>${this.escapeHtml(error)}</li>`).join('')}</ul></div>`
      : '';

    return `<article class="reviewer-block">
      <div class="reviewer-head">
        <div>
          <h3>${this.escapeHtml(reviewer.reviewerName)}</h3>
          <p class="meta-line">${this.escapeHtml(reviewer.directory)}</p>
          <div class="file-list">${reviewer.zipNames.map((zipName) => `<span class="file-chip">${this.escapeHtml(zipName)}</span>`).join('')}</div>
        </div>
        ${this.renderReviewerStatus(reviewer.status)}
      </div>
      <table>
        <thead>
          <tr>
            <th>Rapport attendu</th>
            <th>Fichier déposé</th>
            <th>Date</th>
            <th>Statut</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${missingReports}
      ${unmatchedDeposits ? `<h3 style="margin-top:0.8rem;">Dépôts non rattachés</h3>${unmatchedDeposits}` : ''}
      ${errors}
    </article>`;
  }

  private renderMissingReportsBlock(reviewer: ReviewerReport): string {
    const missing = this.resolveMissingMatches(reviewer);
    if (missing.length === 0) {
      return '';
    }

    return `<div class="notice-block missing-block">
      <h3>Rapports manquants</h3>
      <ul>${missing.map((match) => `<li><strong>${this.escapeHtml(match.expected.label)}</strong>${this.renderExpectedSourceDetails(match.expected)}</li>`).join('')}</ul>
    </div>`;
  }

  private renderExpectedSourceDetails(expected: ExpectedReport): string {
    return [
      `<small>Chemin dans le ZIP : ${this.escapeHtml(expected.zipEntryName)}</small>`,
      `<small>Archive : ${this.escapeHtml(expected.sourceZip)}</small>`,
    ].join('');
  }

  private resolveDepositedMatches(reviewer: ReviewerReport): MatchedReport[] {
    return reviewer.matchedReports.filter((match) => match.status === 'deposited');
  }

  private resolveMissingMatches(reviewer: ReviewerReport): MatchedReport[] {
    return reviewer.matchedReports.filter((match) => match.status === 'missing');
  }

  private renderEmptyReport(): string {
    return `<div class="empty-state">
      Aucun ZIP n’a été trouvé. Sélectionnez le dossier ownCloud qui contient les répertoires des rapporteurs, chacun avec son archive ZIP.
    </div>`;
  }

  private renderKpi(value: number, label: string): string {
    return `<div class="kpi"><strong>${value}</strong><span>${this.escapeHtml(label)}</span></div>`;
  }

  private renderDepositFile(deposit: DepositFile): string {
    return `<strong>${this.escapeHtml(deposit.name)}</strong><small>${this.escapeHtml(this.formatFileSize(deposit.size))}</small>`;
  }

  private renderDepositDate(deposit: DepositFile | null): string {
    if (!deposit) {
      return '-';
    }

    return `${this.escapeHtml(deposit.modifiedAtLabel)}<small>${this.escapeHtml(deposit.relativeTimeLabel)}</small>`;
  }

  private renderReviewerStatus(status: ReviewerReport['status']): string {
    const label = status === 'complete'
      ? 'Complet'
      : status === 'partial'
        ? 'Incomplet'
        : status === 'empty'
          ? 'Aucun dépôt'
          : 'À vérifier';

    return `<span class="status-pill status-${status}">${label}</span>`;
  }

  private renderMatchStatus(status: DepositMatchStatus): string {
    const label = status === 'deposited'
      ? 'Déposé'
      : status === 'probable'
        ? 'Déposé, à vérifier'
        : 'Manquant';

    return `<span class="status-pill status-${status}">${label}</span>`;
  }

  private createReportFileName(date: Date): string {
    const stamp = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
      '-',
      String(date.getHours()).padStart(2, '0'),
      String(date.getMinutes()).padStart(2, '0'),
      String(date.getSeconds()).padStart(2, '0'),
    ].join('');

    return `reporting-depots-rapporteurs-${stamp}.html`;
  }

  private formatDateTime(date: Date): string {
    return new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(date);
  }

  private formatRelativeTime(date: Date, now: Date): string {
    const diffMs = now.getTime() - date.getTime();
    const future = diffMs < 0;
    const seconds = Math.max(0, Math.round(Math.abs(diffMs) / 1000));

    if (seconds < 60) {
      return future ? 'dans moins d’une minute' : 'à l’instant';
    }

    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
      return future ? `dans ${minutes} min` : `il y a ${minutes} min`;
    }

    const hours = Math.round(minutes / 60);
    if (hours < 24) {
      return future ? `dans ${hours} h` : `il y a ${hours} h`;
    }

    const days = Math.round(hours / 24);
    if (days === 1 && !future) {
      return 'hier';
    }
    if (days < 31) {
      return future ? `dans ${days} j` : `il y a ${days} j`;
    }

    const months = Math.round(days / 30);
    if (months < 12) {
      return future ? `dans ${months} mois` : `il y a ${months} mois`;
    }

    const years = Math.round(months / 12);
    return future ? `dans ${years} an(s)` : `il y a ${years} an(s)`;
  }

  private formatFileSize(size: number): string {
    if (size < 1024) {
      return `${size} o`;
    }

    const kb = size / 1024;
    if (kb < 1024) {
      return `${kb.toFixed(kb >= 100 ? 0 : 1)} Ko`;
    }

    const mb = kb / 1024;
    return `${mb.toFixed(mb >= 100 ? 0 : 1)} Mo`;
  }

  private relativePathLabel(value: string): string {
    return path.basename(value) || value;
  }

  private formatDirectoryRelativeToRoot(rootDir: string, directory: string): string {
    const relative = path.relative(rootDir, directory);
    if (!relative || relative.startsWith('..')) {
      return directory;
    }

    return relative.split(path.sep).join('/');
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
