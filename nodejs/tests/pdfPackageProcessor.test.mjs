import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PdfPackageProcessor } from '../dist/services/pdf/pdfPackageProcessor.js';

async function fixture(t, files) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cac-pdf-package-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const output = path.join(root, 'output');
  await mkdir(source);
  await mkdir(output);
  for (const [relative, content] of Object.entries(files)) {
    const filename = path.join(source, relative);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, content);
  }
  const processed = [];
  const processor = new PdfPackageProcessor({
    async process(context) {
      processed.push(context.relativePath);
      await copyFile(context.workingPath, context.targetPath());
      return context;
    },
    async disposeSharedResources() {},
  });
  return { root, source, output, processed, processor };
}

test('PDF conversion collisions abort the whole batch before writing any file', async (t) => {
  const { source, output, processed, processor } = await fixture(t, {
    'A.pdf': 'unrelated source',
    'CV.pdf': 'original PDF',
    'CV.rtf': 'document to convert',
  });
  const recipientDir = path.join(output, 'Alice', 'CAC');
  await mkdir(recipientDir, { recursive: true });
  await writeFile(path.join(recipientDir, 'CV.pdf'), 'previous result');

  await assert.rejects(
    processor.prepare([{ name: 'Alice', files: ['A.pdf', 'CV.pdf', 'CV.rtf'] }], source, output, 'member', 'CAC'),
    (error) => {
      assert.match(error.message, /Collision de fichiers/);
      assert.match(error.message, /CV\.pdf/);
      assert.match(error.message, /CV\.rtf/);
      assert.match(error.message, /Alice/);
      return true;
    },
  );
  assert.deepEqual(processed, []);
  assert.deepEqual(await readdir(recipientDir), ['CV.pdf']);
  assert.equal(await readFile(path.join(recipientDir, 'CV.pdf'), 'utf8'), 'previous result');
});

test('collisions are checked across packages that sanitize to the same recipient directory', async (t) => {
  const { source, output, processed, processor } = await fixture(t, { 'CV.pdf': 'PDF', 'CV.docx': 'Word' });
  await assert.rejects(
    processor.prepare([
      { name: 'Alice Bob', files: ['CV.pdf'] },
      { name: 'Alice_Bob', files: ['CV.docx'] },
    ], source, output, 'member'),
    /Collision de fichiers/,
  );
  assert.deepEqual(processed, []);
});

test('collision detection resolves aliases of destination directories', async (t) => {
  const { source, output, processed, processor } = await fixture(t, {
    'one/CV.pdf': 'PDF',
    'two/CV.odt': 'document',
  });
  const recipientDir = path.join(output, 'Alice');
  await mkdir(path.join(recipientDir, 'one'), { recursive: true });
  await symlink(path.join(recipientDir, 'one'), path.join(recipientDir, 'two'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(
    processor.prepare([{ name: 'Alice', files: ['one/CV.pdf', 'two/CV.odt'] }], source, output, 'member'),
    /Collision de fichiers/,
  );
  assert.deepEqual(processed, []);
});

test('destination case follows the platform convention', async (t) => {
  const { source, output, processed, processor } = await fixture(t, { 'CV.pdf': 'PDF', 'cv.doc': 'Word' });
  const preparation = processor.prepare([{ name: 'Alice', files: ['CV.pdf', 'cv.doc'] }], source, output, 'member');
  if (process.platform === 'win32' || process.platform === 'darwin') {
    await assert.rejects(preparation, /Collision de fichiers/);
    assert.deepEqual(processed, []);
  } else {
    const stats = await preparation;
    assert.equal(stats.processedFiles, 2);
    assert.equal(await readFile(path.join(output, 'Alice', 'CV.pdf'), 'utf8'), 'PDF');
    assert.equal(await readFile(path.join(output, 'Alice', 'cv.pdf'), 'utf8'), 'Word');
  }
});

test('repeated references to the same source are processed once per destination', async (t) => {
  const { source, output, processed, processor } = await fixture(t, { 'CV.pdf': 'PDF', 'CV.rtf': 'unassigned' });
  const updates = [];
  const stats = await processor.prepare([
    { name: 'Alice', files: ['CV.pdf', 'cv.PDF', 'CV.pdf'] },
    { name: 'Alice', files: ['CV.pdf'] },
  ], source, output, 'member', '', undefined, undefined, undefined, (update) => updates.push(update));
  assert.equal(stats.processedFiles, 1);
  assert.equal(stats.processedRecipients, 1);
  assert.deepEqual(stats.errors, []);
  assert.deepEqual(processed, ['CV.pdf']);
  assert.deepEqual(updates.at(-1), { total: 1, completed: 1 });
});

test('the same PDF basename remains allowed in separate folders and recipients', async (t) => {
  const { source, output, processor } = await fixture(t, {
    'first/CV.pdf': 'first',
    'second/CV.docx': 'second',
  });
  const stats = await processor.prepare([
    { name: 'Alice', files: ['first/CV.pdf', 'second/CV.docx'] },
    { name: 'Bob', files: ['first/CV.pdf'] },
  ], source, output, 'member');
  assert.equal(stats.processedFiles, 3);
  assert.equal(stats.processedRecipients, 2);
  assert.deepEqual(stats.errors, []);
  assert.equal(await readFile(path.join(output, 'Alice', 'first', 'CV.pdf'), 'utf8'), 'first');
  assert.equal(await readFile(path.join(output, 'Alice', 'second', 'CV.pdf'), 'utf8'), 'second');
  assert.equal(await readFile(path.join(output, 'Bob', 'first', 'CV.pdf'), 'utf8'), 'first');
});
