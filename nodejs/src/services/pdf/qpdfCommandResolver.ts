import { access } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const fileExists = async (candidate: string): Promise<boolean> => {
  try {
    await access(candidate, fsConstants.F_OK);
    if (process.platform !== 'win32') {
      await access(candidate, fsConstants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
};

const resolveCandidatesForPlatform = (root: string): string[] => {
  if (!root) {
    return [];
  }

  if (process.platform === 'win32') {
    const arch = process.arch;
    return [
      path.join(root, 'win', arch, 'qpdf.exe'),
      path.join(root, 'win', 'qpdf.exe'),
    ];
  }

  if (process.platform === 'darwin') {
    return [path.join(root, 'mac', 'qpdf')];
  }

  return [];
};

const resolveExecutableInPath = async (command: string): Promise<string | null> => {
  const searchPath = process.env.PATH ?? '';
  if (searchPath === '') {
    return null;
  }

  const directories = searchPath.split(path.delimiter).filter((entry) => entry && entry.trim() !== '');
  if (directories.length === 0) {
    return null;
  }

  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
          .split(';')
          .map((ext) => ext.trim())
          .filter((ext) => ext !== '')
      : [''];

  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate =
        process.platform === 'win32' && extension !== ''
          ? path.join(directory, `${command}${extension}`)
          : path.join(directory, command);

      if (await fileExists(candidate)) {
        return candidate;
      }
    }
  }

  return null;
};

export class QpdfCommandResolver {
  async resolve(): Promise<string> {
    const envCommand = process.env.QPDF_COMMAND?.trim();
    if (envCommand) {
      return envCommand;
    }

    const systemCommand = await resolveExecutableInPath('qpdf');
    if (systemCommand) {
      return systemCommand;
    }

    const embedded = await this.resolveEmbeddedCommand();
    if (embedded) {
      return embedded;
    }

    return 'qpdf';
  }

  private async resolveEmbeddedCommand(): Promise<string | null> {
    for (const root of this.getCandidateRoots()) {
      const resolved = await this.resolveFromRoot(root);
      if (resolved) {
        return resolved;
      }
    }

    return null;
  }

  private getCandidateRoots(): string[] {
    const roots: string[] = [];

    const addRoot = (root: string | null | undefined) => {
      if (!root) {
        return;
      }
      for (const candidate of this.expandAsarRoot(root)) {
        if (!roots.includes(candidate)) {
          roots.push(candidate);
        }
      }
    };

    if (typeof process.resourcesPath === 'string' && process.resourcesPath !== '') {
      addRoot(path.join(process.resourcesPath, 'resources', 'commands'));
      addRoot(path.join(process.resourcesPath, 'commands'));
      addRoot(path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'commands'));
      addRoot(path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'resources', 'commands'));
    }

    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    addRoot(path.join(moduleDir, '..', '..', '..', 'commands'));
    addRoot(path.join(moduleDir, '..', '..', 'resources', 'commands'));
    addRoot(path.join(moduleDir, '..', '..', '..', 'resources', 'commands'));
    addRoot(path.join(moduleDir, '..', '..', '..', '..', 'resources', 'commands'));
    addRoot(path.join(process.cwd(), 'commands'));

    return roots;
  }

  private expandAsarRoot(root: string): string[] {
    if (!root.includes('.asar')) {
      return [root];
    }

    const unpacked = root.replace(/\.asar(\/|\\)/, '.asar.unpacked$1');
    return unpacked === root ? [unpacked, root] : [unpacked, root];
  }

  private async resolveFromRoot(root: string): Promise<string | null> {
    for (const candidate of resolveCandidatesForPlatform(root)) {
      if (await fileExists(candidate)) {
        return candidate;
      }
    }

    return null;
  }
}
