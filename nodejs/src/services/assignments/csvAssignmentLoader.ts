import { readFile } from 'fs/promises';
import path from 'path';
import XLSX from 'xlsx';
import { parseCsv, CsvTable } from '../../utils/csv.js';

export interface ReviewerAssignment {
  file: string;
  reviewers: string[];
  source: 'csv';
  label?: string;
}

export interface MemberAssignment {
  name: string;
  files: string[];
  source: 'csv';
}

export class CsvAssignmentLoader {
  async reviewers(pathname: string, availableFiles: string[] = []): Promise<ReviewerAssignment[]> {
    const extension = path.extname(pathname).toLowerCase();
    if (extension === '.xlsx' || extension === '.xls') {
      return this.reviewersFromWorkbook(pathname, availableFiles);
    }
    return this.reviewersFromCsvFile(pathname);
  }

  private async reviewersFromCsvFile(pathname: string): Promise<ReviewerAssignment[]> {
    const table = await this.readCsv(pathname);
    if (!table.headers.length) {
      return [];
    }

    const headers = table.headers;
    const fileHeader = headers.find((header) => header.toLowerCase() === 'file') ?? headers[0] ?? 'file';
    const assignments: ReviewerAssignment[] = [];

    for (const row of table.records) {
      const file = (row[fileHeader] ?? '').toString().trim();
      if (file === '') {
        continue;
      }

      const reviewers: string[] = [];
      for (const [key, value] of Object.entries(row)) {
        if (!key.toLowerCase().startsWith('reviewer')) {
          continue;
        }

        const candidate = value?.toString().trim() ?? '';
        if (candidate !== '') {
          reviewers.push(candidate);
        }
      }

      if (reviewers.length === 0) {
        continue;
      }

      assignments.push({ file, reviewers, source: 'csv', label: file });
    }

    return assignments;
  }

  private async reviewersFromWorkbook(pathname: string, availableFiles: string[]): Promise<ReviewerAssignment[]> {
    try {
      const workbook = XLSX.readFile(pathname, { cellDates: false });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        return [];
      }

      const sheet = workbook.Sheets[sheetName];
      if (!sheet) {
        return [];
      }

      const rows = readVisibleSheetRows(sheet);
      const normalizedRows = rows.map((row) => this.normalizeSpreadsheetRow(row));
      const matcher = new PdfFileMatcher(availableFiles);
      const assignments: ReviewerAssignment[] = [];

      for (const row of normalizedRows) {
        const lastName = getFirstNonEmpty(row, ['nomdusage', 'nomusage', 'nom']);
        const firstName = getFirstNonEmpty(row, ['prenom', 'prenoms']);
        const reviewers = this.extractReviewersFromRow(row);

        if (reviewers.length === 0) {
          continue;
        }

        if (!lastName && !firstName) {
          continue;
        }

        const matchedFile = matcher.findBestMatch(firstName, lastName);
        const fallbackFile = this.buildFallbackFileName(firstName, lastName);

        assignments.push({
          file: matchedFile ?? fallbackFile,
          reviewers,
          source: 'csv',
          label: this.buildDisplayName(firstName, lastName),
        });
      }

      return assignments;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Impossible de lire le fichier Excel: ${pathname}. ${message}`);
    }
  }

  async members(pathname: string, availableFiles: string[] = []): Promise<MemberAssignment[]> {
    const extension = path.extname(pathname).toLowerCase();
    if (extension === '.xlsx' || extension === '.xls') {
      return this.membersFromWorkbook(pathname, availableFiles);
    }
    const table = await this.readCsv(pathname);
    if (!table.headers.length) {
      return [];
    }

    // Build a map of normalized header -> original header key present in rows
    const headerMap = new Map<string, string>();
    for (const raw of table.headers) {
      const trimmed = (raw ?? '').toString().trim();
      if (trimmed !== '') {
        const lc = trimmed.toLowerCase();
        if (!headerMap.has(lc)) {
          headerMap.set(lc, raw);
        }
      }
    }

    const matcher = availableFiles.length > 0 ? new PdfFileMatcher(availableFiles) : null;

    const memberKeyLc = ['member', 'membre'].find((key) => headerMap.has(key));
    if (memberKeyLc) {
      const memberHeader = headerMap.get(memberKeyLc)!; // original header as it appears in row keys
      const assignments = new Map<string, MemberAssignment>();

      for (const row of table.records) {
        const memberName = (row[memberHeader] ?? '').toString().trim();
        if (memberName === '') {
          continue;
        }

        const paths = Object.entries(row)
          .filter(([key]) => key !== memberHeader)
          .flatMap(([, value]) =>
            (value ?? '')
              .toString()
              .split(/[;\r\n]/)
              .map((candidate) => candidate.trim())
              .filter((candidate) => candidate !== ''),
          );
        const normalizedPaths = paths
          .map((candidate) => this.resolveMemberReference(candidate, matcher))
          .filter((candidate) => candidate !== '');

        const key = memberName.toLowerCase();
        if (!assignments.has(key)) {
          assignments.set(key, { name: memberName, files: [], source: 'csv' });
        }

        if (normalizedPaths.length > 0) {
          const current = assignments.get(key)!;
          current.files = Array.from(new Set([...current.files, ...normalizedPaths])).sort((a, b) => a.localeCompare(b));
        }
      }

      return Array.from(assignments.values());
    }

    const names: string[] = Array.from(headerMap.values()).map((h) => (h ?? '').toString().trim()).filter((h) => h !== '');
    for (const row of table.records) {
      for (const value of Object.values(row)) {
        const member = value?.toString().trim() ?? '';
        if (member !== '') {
          names.push(member);
        }
      }
    }

    const uniqueNames: string[] = [];
    const seen = new Set<string>();
    for (const name of names) {
      const key = name.toLowerCase();
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      uniqueNames.push(name);
    }

    return uniqueNames.map((name) => ({ name, files: [], source: 'csv' as const }));
  }

  private async membersFromWorkbook(pathname: string, availableFiles: string[]): Promise<MemberAssignment[]> {
    try {
      const workbook = XLSX.readFile(pathname, { cellDates: false });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        return [];
      }

      const sheet = workbook.Sheets[sheetName];
      if (!sheet) {
        return [];
      }

      const rows = readVisibleSheetRows(sheet);
      const normalizedRows = rows.map((row) => this.normalizeSpreadsheetRow(row));
      const matcher = availableFiles.length > 0 ? new PdfFileMatcher(availableFiles) : null;
      const assignments = new Map<string, MemberAssignment>();

      for (const row of normalizedRows) {
        const name = row.get('nom') ?? row.get('name') ?? row.get('membre') ?? '';
        if (!name) {
          continue;
        }

        const files: string[] = [];
        for (const [key, value] of row.entries()) {
          if (key === 'nom' || key === 'name' || key === 'membre') {
            continue;
          }

          const raw = value ?? '';
          const parts = raw
            .toString()
            .split(/[;\r\n]/)
            .map((candidate) => candidate.trim())
            .filter((candidate) => candidate !== '');
          files.push(...parts);
        }

        const normalizedFiles = files
          .map((candidate) => this.resolveMemberReference(candidate, matcher))
          .filter((candidate) => candidate !== '');

        const key = name.toLowerCase();
        if (!assignments.has(key)) {
          assignments.set(key, { name, files: [], source: 'csv' });
        }

        if (normalizedFiles.length > 0) {
          const current = assignments.get(key)!;
          current.files = Array.from(new Set([...current.files, ...normalizedFiles])).sort((a, b) => a.localeCompare(b));
        }
      }

      return Array.from(assignments.values());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Impossible de lire le fichier Excel: ${pathname}. ${message}`);
    }
  }

  private async readCsv(pathname: string): Promise<CsvTable> {
    try {
      const contents = await readFile(pathname, 'utf-8');
      return parseCsv(contents);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Impossible de trouver le fichier CSV: ${pathname}. ${message}`);
    }
  }

  private normalizeSpreadsheetRow(row: Record<string, unknown>): Map<string, string> {
    const normalized = new Map<string, string>();

    for (const [rawKey, rawValue] of Object.entries(row)) {
      const key = normalizeHeader(rawKey);
      if (!key) {
        continue;
      }

      const value = rawValue === null || rawValue === undefined ? '' : rawValue.toString().trim();
      normalized.set(key, value);
    }

    return normalized;
  }

  private extractReviewersFromRow(row: Map<string, string>): string[] {
    const reviewers: string[] = [];

    for (const [key, value] of row.entries()) {
      if (!value) {
        continue;
      }

      if (key.startsWith('rapporteur') || key.startsWith('reviewer')) {
        reviewers.push(value);
      }
    }

    return Array.from(new Set(reviewers));
  }

  private buildFallbackFileName(firstName: string, lastName: string): string {
    const parts = [lastName, firstName].map((value) => value.trim()).filter((value) => value.length > 0);
    if (parts.length === 0) {
      return 'document.pdf';
    }

    const label = parts.join(' ').replace(/\s+/g, ' ').trim();
    return `${label}.pdf`;
  }

  private buildDisplayName(firstName: string, lastName: string): string {
    const parts = [lastName, firstName].map((value) => value.trim()).filter((value) => value.length > 0);
    if (parts.length === 0) {
      return 'Rapporteur';
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  private resolveMemberReference(value: string, matcher: PdfFileMatcher | null): string {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }

    if (!matcher || !looksLikeNameReference(trimmed)) {
      return trimmed;
    }

    return matcher.findByNameReference(trimmed) ?? this.buildFallbackFileNameFromReference(trimmed);
  }

  private buildFallbackFileNameFromReference(reference: string): string {
    const normalized = reference.replace(/\s+/g, ' ').trim();
    return normalized === '' ? 'document.pdf' : `${normalized}.pdf`;
  }
}

const normalizeHeader = (value: string): string => {
  if (!value) {
    return '';
  }

  return value
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
};

const normalizeNameToken = (value: string): string => {
  if (!value) {
    return '';
  }

  const collapsed = value
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/['’]/g, '')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  return collapsed;
};

const normalizeCandidateToken = (value: string): string => {
  if (!value) {
    return '';
  }

  const collapsed = value
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/['’]/g, '')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return collapsed === '' ? '' : ` ${collapsed} `;
};

const getFirstNonEmpty = (row: Map<string, string>, keys: string[]): string => {
  for (const key of keys) {
    const value = row.get(key);
    if (value && value.trim() !== '') {
      return value.trim();
    }
  }
  return '';
};

const looksLikeNameReference = (value: string): boolean => {
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
};

export class PdfFileMatcher {
  private readonly candidates: Array<{ original: string; normalized: string }>;

  constructor(files: string[]) {
    this.candidates = files
      .filter((file) => file.toLowerCase().endsWith('.pdf'))
      .map((file) => ({
        original: file,
        normalized: normalizeCandidateToken(path.basename(file, path.extname(file))),
      }));
  }

  findBestMatch(firstName: string, lastName: string): string | null {
    const normalizedFirst = normalizeNameToken(firstName);
    const normalizedLast = normalizeNameToken(lastName);

    if (!normalizedFirst && !normalizedLast) {
      return null;
    }

    let bestScore = 0;
    let bestMatch: string | null = null;

    for (const candidate of this.candidates) {
      const score = this.scoreCandidate(candidate.normalized, normalizedFirst, normalizedLast);
      if (score === 0) {
        continue;
      }

      if (score > bestScore || (score === bestScore && bestMatch !== null && this.isBetterCandidate(candidate.original, bestMatch))) {
        bestScore = score;
        bestMatch = candidate.original;
      } else if (score > bestScore || bestMatch === null) {
        bestScore = score;
        bestMatch = candidate.original;
      }
    }

    return bestMatch;
  }

  findByNameReference(reference: string): string | null {
    const normalized = reference.replace(/\s+/g, ' ').trim();
    if (normalized === '') {
      return null;
    }

    const firstSpace = normalized.indexOf(' ');
    if (firstSpace === -1) {
      return this.findBestMatch(normalized, '') ?? this.findBestMatch('', normalized);
    }

    const firstPart = normalized.slice(0, firstSpace);
    const restPart = normalized.slice(firstSpace + 1);

    return (
      this.findBestMatch(firstPart, restPart) ??
      this.findBestMatch(restPart, firstPart) ??
      this.findBestMatch(normalized, '') ??
      null
    );
  }

  private scoreCandidate(candidate: string, firstName: string, lastName: string): number {
    let score = 0;
    const firstPattern = firstName ? ` ${firstName} ` : '';
    const lastPattern = lastName ? ` ${lastName} ` : '';
    const hasFirst = firstPattern !== '' && candidate.includes(firstPattern);
    const hasLast = lastPattern !== '' && candidate.includes(lastPattern);

    if (!hasFirst && !hasLast) {
      return 0;
    }

    if (firstPattern !== '' && lastPattern !== '' && (!hasFirst || !hasLast)) {
      return 0;
    }

    if (hasLast) {
      score += 20;
    }

    if (hasFirst) {
      score += 10;
    }

    if (hasFirst && hasLast) {
      score += 100;

      const firstIndexRaw = hasFirst ? candidate.indexOf(firstPattern) : -1;
      const lastIndexRaw = hasLast ? candidate.indexOf(lastPattern) : -1;
      const firstIndex = firstIndexRaw >= 0 ? firstIndexRaw + 1 : firstIndexRaw;
      const lastIndex = lastIndexRaw >= 0 ? lastIndexRaw + 1 : lastIndexRaw;

      if (firstIndex >= 0 && lastIndex >= 0) {
        const distance = Math.abs(firstIndex - lastIndex);
        if (distance <= Math.max(firstName.length, lastName.length)) {
          score += 5;
        } else if (distance <= candidate.length / 2) {
          score += 2;
        }

        if (lastIndex <= firstIndex) {
          score += 3;
        } else {
          score += 1;
        }
      }
    }

    return score;
  }

  private isBetterCandidate(candidate: string, current: string): boolean {
    if (candidate.length !== current.length) {
      return candidate.length < current.length;
    }

    return candidate.localeCompare(current, undefined, { sensitivity: 'base' }) < 0;
  }
}

const readVisibleSheetRows = (sheet: XLSX.WorkSheet): Record<string, unknown>[] => {
  const ref = sheet['!ref'];
  if (!ref) {
    return [];
  }

  const range = XLSX.utils.decode_range(ref);
  const result: Record<string, unknown>[] = [];
  const header: string[] = [];
  let headerInitialized = false;
  const rowsMeta = sheet['!rows'] ?? [];

  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex++) {
    if (rowsMeta[rowIndex]?.hidden) {
      continue;
    }

    const rowValues: string[] = [];
    let hasContent = false;

    for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex++) {
      const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
      const cell = sheet[cellAddress];
      const raw = cell?.w ?? cell?.v ?? '';
      const value = raw === undefined || raw === null ? '' : raw.toString();
      if (!hasContent && value.trim() !== '') {
        hasContent = true;
      }
      rowValues.push(value);
    }

    if (!headerInitialized) {
      if (!hasContent) {
        continue;
      }
      for (let index = 0; index < rowValues.length; index++) {
        const key = rowValues[index]?.toString().trim();
        header.push(key && key !== '' ? key : `col_${index}`);
      }
      headerInitialized = true;
      continue;
    }

    if (!hasContent) {
      continue;
    }

    const record: Record<string, unknown> = {};
    header.forEach((key, idx) => {
      record[key] = (rowValues[idx] ?? '').toString();
    });

    const isEmpty = Object.values(record).every((value) => (value ?? '').toString().trim() === '');
    if (isEmpty) {
      continue;
    }

    result.push(record);
  }

  return result;
};
