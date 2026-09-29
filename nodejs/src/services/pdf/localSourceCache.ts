import { copyFile, mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { throwIfPipelineCancelled } from '../pipeline/pipelineCancelledError.js';

// One local snapshot per input for the duration of a preparation run. Shared
// stages and different recipients read this snapshot instead of a network file.
export class LocalSourceCache {
  private workspace: Promise<string> | null = null;
  private readonly copies = new Map<string, Promise<string>>();

  get(sourcePath: string, abortSignal?: AbortSignal): Promise<string> {
    throwIfPipelineCancelled(abortSignal);
    const existing = this.copies.get(sourcePath);
    if (existing) return existing;

    this.workspace ??= mkdtemp(path.join(os.tmpdir(), 'cac-src-'));
    const basename = `input-${this.copies.size + 1}${path.extname(sourcePath).toLowerCase()}`;
    const copy = this.workspace.then(async (directory) => {
      throwIfPipelineCancelled(abortSignal);
      const destination = path.join(directory, basename);
      await copyFile(sourcePath, destination);
      throwIfPipelineCancelled(abortSignal);
      return destination;
    });
    this.copies.set(sourcePath, copy);
    return copy;
  }

  async dispose(): Promise<void> {
    await Promise.allSettled(this.copies.values());
    const directory = await this.workspace?.catch(() => null);
    if (directory) await rm(directory, { recursive: true, force: true });
    this.copies.clear();
    this.workspace = null;
  }
}
