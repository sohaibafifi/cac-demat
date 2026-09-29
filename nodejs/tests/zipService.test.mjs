import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { ZipService } from '../dist/services/zip/zipService.js';
import { PipelineCancelledError } from '../dist/services/pipeline/pipelineCancelledError.js';

const execFileAsync = promisify(execFile);

async function archiveEntries(zipPath) {
  if (process.platform !== 'win32') {
    const { stdout } = await execFileAsync('unzip', ['-Z1', zipPath]);
    return stdout.trim().split(/\r?\n/);
  }
  // Inspect a short local copy because .NET Framework can reject a long path.
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'cac-zip-check-'));
  try {
    const localArchive = path.join(workspace, 'archive.zip');
    await copyFile(zipPath, localArchive);
    const escaped = localArchive.replace(/'/g, "''");
    const script = `$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.IO.Compression.FileSystem; $archive = [System.IO.Compression.ZipFile]::OpenRead('${escaped}'); try { ConvertTo-Json -InputObject @($archive.Entries | ForEach-Object { $_.FullName }) -Compress } finally { $archive.Dispose() }`;
    const { stdout } = await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', script]);
    return JSON.parse(stdout).map((entry) => entry.replaceAll('\\', '/'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

test('ZipService adds a second batch to an existing archive', async () => {
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

    const entries = await archiveEntries(zipPath);
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
  assert.match(command.args.at(-1), /\$ErrorActionPreference = 'Stop'/);
  assert.match(command.args.at(-1), /-ErrorAction Stop/);
});

for (const location of ['root', 'nested', 'symlink']) {
  test(`ZipService preserves the source when its archive is inside it (${location})`, {
    skip: process.platform === 'win32' && location === 'symlink' ? 'Directory symlinks require Windows privileges.' : false,
  }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cac-zip-preserve-'));
    try {
      const sourceDir = path.join(root, 'source');
      await mkdir(path.join(sourceDir, 'nested'), { recursive: true });
      const sourceFile = path.join(sourceDir, 'CV.pdf');
      await writeFile(sourceFile, 'original document');
      let zipDir = location === 'root' ? sourceDir : path.join(sourceDir, 'nested');
      if (location === 'symlink') {
        const alias = path.join(root, 'alias');
        await symlink(zipDir, alias, 'dir');
        zipDir = alias;
      }
      const zipPath = path.join(zipDir, 'package.zip');
      const result = await new ZipService().zipAll([{ sourceDir, zipPath }], { removeSource: true });
      assert.deepEqual(result, { created: 1, skipped: 0, errors: [] });
      assert.equal(await readFile(sourceFile, 'utf8'), 'original document');
      const entries = await archiveEntries(zipPath);
      assert.ok(entries.includes('source/CV.pdf'));
      assert.ok(!entries.some((entry) => entry.includes('.partial-')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('ZIP creation and replacement support a long final filename without longer temporary names', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cac-zip-long-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceDir = path.join(root, 'CAC_2026');
  const zipPath = path.join(root, `${'x'.repeat(220)}.zip`);
  const service = new ZipService();
  for (const batch of ['MCF', 'PR']) {
    await mkdir(sourceDir, { recursive: true });
    await writeFile(path.join(sourceDir, `${batch}.pdf`), batch);
    const result = await service.zipAll([{ sourceDir, zipPath }], { removeSource: true });
    assert.deepEqual(result, { created: 1, skipped: 0, errors: [] });
    assert.deepEqual(await readdir(root), [path.basename(zipPath)]);
  }
  const entries = await archiveEntries(zipPath);
  assert.ok(entries.includes('CAC_2026/MCF.pdf'));
  assert.ok(entries.includes('CAC_2026/PR.pdf'));
});

test('compound names and accents survive local ZIP staging and repeated in-source archives', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cac-zip-names-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceDir = path.join(root, 'Exemple-Membre_Prénom-Composé');
  const zipPath = path.join(sourceDir, 'CAC 2026 - Exemple-Membre Prénom-Composé.zip');
  const files = ['Candidat-Exemple Prénom-A', 'Candidat-Test Prénom-B'].map((name) => `${name}/Rapport.pdf`);
  for (const relative of files) {
    await mkdir(path.dirname(path.join(sourceDir, relative)), { recursive: true });
    await writeFile(path.join(sourceDir, relative), relative);
  }
  const service = new ZipService();
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await service.zipAll([{ sourceDir, zipPath }], { removeSource: true });
    assert.deepEqual(result, { created: 1, skipped: 0, errors: [] });
    const entries = await archiveEntries(zipPath);
    for (const relative of files) {
      assert.ok(entries.includes(`Exemple-Membre_Prénom-Composé/${relative}`));
      assert.equal(await readFile(path.join(sourceDir, relative), 'utf8'), relative);
    }
    assert.ok(!entries.some((entry) => entry.includes('.zip')), 'the archive must never contain itself');
    assert.ok(!entries.some((entry) => entry.includes('.cac-')));
  }
});

for (const failure of ['compressor', 'cancelled', 'publication']) {
  test(`ZIP ${failure} failure retains the source and previous archive and cleans local staging`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cac-zip-fail-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const sourceDir = path.join(root, 'source');
    const zipPath = path.join(root, 'previous.zip');
    await mkdir(sourceDir);
    await writeFile(path.join(sourceDir, 'new.pdf'), 'new document');
    await writeFile(zipPath, 'previous archive');
    const service = new ZipService();
    const controller = new AbortController();
    let localArchive;
    const makeCommand = (folder, archive) => {
      localArchive = archive;
      assert.ok(!archive.startsWith(root), 'compression must happen outside the output tree');
      assert.equal(path.basename(archive), 'archive.zip');
      const outcome = failure === 'compressor'
        ? "require('fs').writeFileSync(process.argv[1], 'partial'); process.stderr.write('synthetic compression error'); process.exit(1);"
        : failure === 'cancelled'
          ? "process.stdout.write('compression started'); setInterval(() => {}, 1000);"
          : "require('fs').writeFileSync(process.argv[1], 'completed archive');";
      const script = "const assert = require('node:assert/strict'); const fs = require('node:fs'); assert.equal(fs.readFileSync('source/new.pdf', 'utf8'), 'new document'); assert.equal(fs.readFileSync(process.argv[1], 'utf8'), 'previous archive'); " + outcome;
      return { command: process.execPath, args: ['-e', script, archive] };
    };
    service.resolveZipCommand = makeCommand;
    service.resolvePowershellCommand = makeCommand;
    if (failure === 'publication') {
      // Enter the real atomic replacement after the old archive is backed up,
      // then force rename to fail by removing the prepared file.
      const replaceArchive = service.replaceArchive.bind(service);
      service.replaceArchive = async (prepared, target, exists) => {
        await rm(prepared);
        return replaceArchive(prepared, target, exists);
      };
    }
    const operation = service.zipAll([{ sourceDir, zipPath }], {
      removeSource: true,
      abortSignal: controller.signal,
      logger: (message) => {
        if (failure === 'cancelled' && message.includes('compression started')) {
          controller.abort(new PipelineCancelledError());
        }
      },
    });
    if (failure === 'cancelled') {
      await assert.rejects(operation, PipelineCancelledError);
    } else {
      const result = await operation;
      assert.equal(result.created, 0);
      assert.equal(result.errors.length, 1);
    }
    assert.equal(await readFile(zipPath, 'utf8'), 'previous archive');
    assert.equal(await readFile(path.join(sourceDir, 'new.pdf'), 'utf8'), 'new document');
    assert.deepEqual((await readdir(root)).sort(), ['previous.zip', 'source']);
    await assert.rejects(access(path.dirname(localArchive)), { code: 'ENOENT' });
  });
}
