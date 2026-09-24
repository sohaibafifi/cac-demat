import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PdfPackageProcessor } from '../dist/services/pdf/pdfPackageProcessor.js';
import { QpdfCommandResolver } from '../dist/services/pdf/qpdfCommandResolver.js';
import { PdfProcessingPipeline } from '../dist/services/pipeline/pdfProcessingPipeline.js';
import { CleanStage } from '../dist/services/pipeline/stages/cleanStage.js';
import { MetadataStage } from '../dist/services/pipeline/stages/metadataStage.js';
import { runCommand } from '../dist/utils/process.js';

function samplePdf() {
  const content = 'BT /F1 12 Tf 72 720 Td (Fictitious candidate) Tj ET\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Author (Private author) /Title (Private title) >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(pdf);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Root 1 0 R /Info 6 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

async function fixture(t) {
  const resolver = new QpdfCommandResolver();
  const command = await resolver.resolve();
  try {
    const version = await runCommand(command, ['--version']);
    assert.equal(version.exitCode, 0, version.stderr);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    t.skip('qpdf is not installed and no bundled executable is available.');
    return null;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), 'cac-pdf-generation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  await mkdir(source);
  const output = path.join(root, 'output');
  const processor = new PdfPackageProcessor(new PdfProcessingPipeline([
    { id: 'clean', stage: new CleanStage(resolver) },
    { id: 'metadata', stage: new MetadataStage(resolver) },
  ]));
  return { root, source, output, processor, command };
}

test('recoverable qpdf warnings still produce a validated PDF and remain visible in the log', async (t) => {
  const files = await fixture(t);
  if (!files) return;
  const { root, source, output, processor, command } = files;
  const sourcePath = path.join(source, 'Candidate.pdf');
  await writeFile(sourcePath, samplePdf().replace(/startxref\n\d+/, 'startxref\n0'));

  const rawExport = await runCommand(command, [sourcePath, '--json-output', path.join(root, 'raw.json'), '--json-stream-data=none']);
  assert.equal(rawExport.exitCode, 3, 'fixture must reproduce successful qpdf output with warnings');
  assert.ok(JSON.parse(await readFile(path.join(root, 'raw.json'), 'utf8')).qpdf);

  const logs = [];
  const stats = await processor.prepare([{ name: 'Alice', files: ['Candidate.pdf'] }], source, output, 'member', '', (message) => logs.push(message));
  assert.equal(stats.processedFiles, 1);
  assert.equal(stats.processedRecipients, 1);
  assert.deepEqual(stats.errors, []);
  assert.ok(logs.some((message) => message.includes('Candidate.pdf') && message.includes('avertissement qpdf')));

  const generated = path.join(output, 'Alice', 'Candidate.pdf');
  const check = await runCommand(command, ['--check', generated]);
  assert.equal(check.exitCode, 0, check.stderr);
  const decoded = path.join(root, 'decoded.pdf');
  const decode = await runCommand(command, ['--qdf', '--stream-data=uncompress', generated, decoded]);
  assert.equal(decode.exitCode, 0, decode.stderr);
  const contents = await readFile(decoded, 'latin1');
  assert.match(contents, /Fictitious candidate/);
  assert.match(contents, /Shared with ALICE/);
  assert.doesNotMatch(contents, /Private author|Private title/);
});

test('unrecoverable PDF failures identify the omitted file and do not count it as generated', async (t) => {
  const files = await fixture(t);
  if (!files) return;
  const { source, output, processor } = files;
  await writeFile(path.join(source, 'Valid.pdf'), samplePdf());
  await writeFile(path.join(source, 'Invalid.pdf'), 'This is not a PDF.');
  const logs = [];
  const stats = await processor.prepare([{ name: 'Alice', files: ['Valid.pdf', 'Invalid.pdf'] }], source, output, 'member', '', (message) => logs.push(message), undefined, undefined, undefined, undefined, ['metadata']);
  assert.equal(stats.processedFiles, 1);
  assert.equal(stats.processedRecipients, 1);
  assert.equal(stats.errors.length, 1);
  assert.equal(stats.errors[0].file, 'Invalid.pdf');
  assert.equal(stats.errors[0].recipient, 'Alice');
  assert.match(stats.errors[0].message, /Impossible de préparer/);
  assert.ok(logs.some((message) => message.includes('Erreur') && message.includes('Invalid.pdf')));
  assert.deepEqual(await readdir(path.join(output, 'Alice')), ['Valid.pdf']);
});
