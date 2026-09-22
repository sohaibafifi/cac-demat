import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NameSanitizer } from '../dist/support/text/nameSanitizer.js';
import { PdfPackageProcessor } from '../dist/services/pdf/pdfPackageProcessor.js';
import { PdfProcessingPipeline } from '../dist/services/pipeline/pdfProcessingPipeline.js';
import { MemberPreparationService } from '../dist/services/pipeline/memberPreparationService.js';
import { ReviewerPreparationService } from '../dist/services/pipeline/reviewerPreparationService.js';
import { ZipService } from '../dist/services/zip/zipService.js';

test('directory and archive labels reject reserved dot names', () => {
  for (const name of ['.', '..', ' .. ', '...']) {
    assert.throws(() => NameSanitizer.sanitize(name, 'collection'), /Nom invalide/);
    assert.throws(() => NameSanitizer.sanitizeForFileName(name, 'collection'), /Nom invalide/);
  }
  assert.equal(NameSanitizer.sanitize('CAC 2026', 'collection'), 'CAC_2026');
  assert.equal(NameSanitizer.sanitizeForFileName('CAC 2026', 'collection'), 'CAC 2026');
  assert.equal(NameSanitizer.sanitize('', 'collection'), 'collection');
});

for (const mode of ['members', 'reviewers']) {
  for (const invalidField of ['collection', 'recipient']) {
    for (const zipEnabled of [true, false]) {
      test(`${mode} reject a reserved ${invalidField} without changing prior output (ZIP ${zipEnabled})`, async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'cac-path-safety-'));
        try {
          const source = path.join(root, 'source');
          const output = path.join(root, 'output');
          const previous = path.join(output, 'Previous_Recipient');
          await mkdir(source);
          await mkdir(previous, { recursive: true });
          await writeFile(path.join(source, 'CV.pdf'), 'original document');
          const sentinel = path.join(previous, 'Existing archive.zip');
          await writeFile(sentinel, 'previous archive');

          const processor = new PdfPackageProcessor(new PdfProcessingPipeline([]));
          const zipper = new ZipService();
          const service = mode === 'members'
            ? new MemberPreparationService(processor, zipper)
            : new ReviewerPreparationService(processor, zipper, null);
          await assert.rejects(
            service.prepare(
              [{ name: invalidField === 'recipient' ? '..' : 'Bob', files: ['CV.pdf'] }],
              source,
              output,
              invalidField === 'collection' ? '..' : 'CAC 2026',
              undefined, undefined, undefined, zipEnabled,
            ),
            /Nom invalide/,
          );
          assert.equal(await readFile(sentinel, 'utf8'), 'previous archive');
          assert.deepEqual(await readdir(output), ['Previous_Recipient']);
          assert.equal(await readFile(path.join(source, 'CV.pdf'), 'utf8'), 'original document');
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      });
    }
  }
}
