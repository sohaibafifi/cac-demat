import { mkdir, realpath, readdir } from 'fs/promises';
import path from 'path';

export interface InventoryEntry {
  name: string;
  type: 'file' | 'directory' | 'other';
}

export interface WorkspaceInventory {
  files: string[];
  entries: InventoryEntry[];
}

export interface AssignmentEntry {
  file?: string;
}

export class WorkspaceService {
  async inventory(folder: string | null | undefined): Promise<WorkspaceInventory> {
    const availableFiles: string[] = [];
    const entries: InventoryEntry[] = [];

    if (!folder) {
      return { files: availableFiles, entries };
    }

    const resolved = await realpath(folder).catch(() => null);
    if (!resolved) {
      return { files: availableFiles, entries };
    }

    await this.walk(resolved, async (relative, type) => {
      entries.push({ name: relative, type });
      if (type === 'file') {
        availableFiles.push(relative);
      }
    });

    availableFiles.sort((a, b) => a.localeCompare(b));
    entries.sort((a, b) => a.name.localeCompare(b.name));

    return { files: availableFiles, entries };
  }

  async resolveOutputPath(folder: string | null | undefined, directory: string): Promise<string> {
    if (!folder) {
      throw new Error('Dossier non défini.');
    }

    const baseDir = await realpath(path.dirname(folder)).catch(() => null);
    if (!baseDir) {
      throw new Error("Impossible de déterminer le dossier de sortie.");
    }

    const target = path.join(baseDir, directory);
    await mkdir(target, { recursive: true, mode: 0o755 });

    return target;
  }

  findMissingFiles(assignments: AssignmentEntry[], availableFiles: string[]): string[] {
    if (!assignments?.length || !availableFiles?.length) {
      return [];
    }

    const known = availableFiles.map((file) => file.toLowerCase());
    const missing = new Set<string>();

    for (const assignment of assignments) {
      const file = assignment.file?.toString().trim();
      if (!file) {
        continue;
      }

      if (!known.includes(file.toLowerCase())) {
        missing.add(file);
      }
    }

    return Array.from(missing);
  }

  private async walk(root: string, visitor: (relative: string, type: InventoryEntry['type']) => Promise<void>): Promise<void> {
    const walkRecursive = async (currentDir: string): Promise<void> => {
      const entries = await readdir(currentDir, { withFileTypes: true });

      for (const dirent of entries) {
        const fullPath = path.join(currentDir, dirent.name);
        const relative = path.relative(root, fullPath).split(path.sep).join('/');

        if (!relative) continue;

        let type: InventoryEntry['type'] = 'other';
        if (dirent.isDirectory()) {
          type = 'directory';
          await visitor(relative, type);
          // Recursively walk subdirectories
          await walkRecursive(fullPath);
        } else if (dirent.isFile()) {
          type = 'file';
          await visitor(relative, type);
        } else {
          await visitor(relative, type);
        }
      }
    };

    await walkRecursive(root);
  }
}
