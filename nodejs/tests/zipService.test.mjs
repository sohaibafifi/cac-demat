import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { ZipService } from '../dist/services/zip/zipService.js';

const execFileAsync = promisify(execFile);

test('ZipService adds a second batch to an existing archive', {
  skip: process.platform === 'win32' ? 'Validated separately through the PowerShell command.' : false,
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cac-zip-merge-'));
  const recipientDir = path.join(root, 'Pierre_Marquis');
  const sourceDir = path.join(recipientDir, 'CAC_2026');
  const zipPath = path.join(recipientDir, 'CAC 2026 - Pierre Marquis.zip');
  const service = new ZipService();

  try {
    await mkdir(sourceDir, { recursive: true });
    await writeFile(path.join(sourceDir, 'MCF.pdf'), 'first batch');
    const first = await service.zipAll([{ sourceDir, zipPath }], { removeSource: true });
    assert.equal(first.errors.length, 0);

    await mkdir(sourceDir, { recursive: true });
    await writeFile(path.join(sourceDir, 'PR.pdf'), 'second batch');
    const second = await service.zipAll([{ sourceDir, zipPath }], { removeSource: true });
    assert.equal(second.errors.length, 0);

    const { stdout } = await execFileAsync('unzip', ['-Z1', zipPath]);
    const entries = stdout.trim().split(/\r?\n/).sort();
    assert.ok(entries.includes('CAC_2026/MCF.pdf'));
    assert.ok(entries.includes('CAC_2026/PR.pdf'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('ZipService uses Compress-Archive update mode for an existing Windows archive', () => {
  const command = new ZipService().resolvePowershellCommand('CAC_2026', 'C:\\Temp\\rapport.zip', true);

  assert.equal(command.command, 'powershell.exe');
  assert.match(command.args.at(-1), /Compress-Archive/);
  assert.match(command.args.at(-1), /-LiteralPath 'CAC_2026'/);
  assert.match(command.args.at(-1), /-Update/);
  assert.doesNotMatch(command.args.at(-1), /-Force/);
});
