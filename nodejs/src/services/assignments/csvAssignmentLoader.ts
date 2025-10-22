import { readFile } from 'fs/promises';
import { parseCsv, CsvTable } from '../../utils/csv.js';

export interface ReviewerAssignment {
  file: string;
  reviewers: string[];
  source: 'csv';
}

export interface MemberAssignment {
  name: string;
  files: string[];
  source: 'csv';
}

export class CsvAssignmentLoader {
  async reviewers(path: string): Promise<ReviewerAssignment[]> {
    const table = await this.readCsv(path);
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

      assignments.push({ file, reviewers, source: 'csv' });
    }

    return assignments;
  }

  async members(path: string): Promise<MemberAssignment[]> {
    const table = await this.readCsv(path);
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

        const key = memberName.toLowerCase();
        if (!assignments.has(key)) {
          assignments.set(key, { name: memberName, files: [], source: 'csv' });
        }

        if (paths.length > 0) {
          const current = assignments.get(key)!;
          current.files = Array.from(new Set([...current.files, ...paths])).sort((a, b) => a.localeCompare(b));
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

  private async readCsv(pathname: string): Promise<CsvTable> {
    try {
      const contents = await readFile(pathname, 'utf-8');
      return parseCsv(contents);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Impossible de trouver le fichier CSV: ${pathname}. ${message}`);
    }
  }
}
