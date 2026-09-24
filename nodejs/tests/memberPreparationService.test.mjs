import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MemberPreparationService } from '../dist/services/pipeline/memberPreparationService.js';

async function resolveMembers(t, filenames, members) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cac-member-pattern-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let resolved = [];
  const service = new MemberPreparationService({
    async collectPdfFiles() {
      return filenames.map((relative) => ({ relative }));
    },
    async prepare(packages) {
      resolved = packages;
      return { requestedRecipients: packages.length, processedRecipients: 0, processedFiles: 0, missingFiles: [], errors: [] };
    },
  }, {
    async zipAll() { throw new Error('ZIP is disabled in this test'); },
  });
  const stats = await service.prepare(members, root, path.join(root, 'output'), '', undefined, undefined, undefined, false);
  return { resolved, stats };
}

test('member wildcards treat regex metacharacters as literal file-name characters', async (t) => {
  const cases = [
    ['A+B/*.pdf', 'A+B/CV.pdf', 'AAB/CV.pdf'],
    ['[draft]/*.pdf', '[draft]/CV.pdf', 'd/CV.pdf'],
    ['[draft/*.pdf', '[draft/CV.pdf', 'draft/CV.pdf'],
    ['A.B/*.pdf', 'A.B/CV.pdf', 'AxB/CV.pdf'],
    ['A(B)/*.pdf', 'A(B)/CV.pdf', 'AB/CV.pdf'],
    ['A|B/*.pdf', 'A|B/CV.pdf', 'A'],
    ['A?/*.pdf', 'A?/CV.pdf', 'A/CV.pdf'],
    ['A^B$/*.pdf', 'A^B$/CV.pdf', 'AB/CV.pdf'],
    ['A{2}/*.pdf', 'A{2}/CV.pdf', 'AA/CV.pdf'],
    ['folder/*.pdf', 'folder/CV.pdf', 'folder/CVxpdf'],
    ['A\\B/*.pdf', 'A\\B/CV.pdf', 'AB/CV.pdf'],
  ];
  const { resolved } = await resolveMembers(t, cases.flatMap(([, match, nonMatch]) => [match, nonMatch]), cases.map(([pattern], index) => ({
    name: `Member ${index}`,
    files: [pattern],
  })));
  assert.deepEqual(resolved, cases.map(([, match], index) => ({ name: `Member ${index}`, files: [match] })));
});

test('literal files, folders, root selection and overlapping wildcards retain their behavior', async (t) => {
  const { resolved } = await resolveMembers(t, ['CV.pdf', 'A+B/CV.pdf', 'A+B/nested/Letter.pdf', 'other/CV.pdf'], [
    { name: 'Exact', files: ['a+b/cv.PDF'] },
    { name: 'Folder', files: ['A+B/'] },
    { name: 'Root', files: ['.'] },
    { name: 'Overlap', files: ['A+B/*', 'A+B/*.pdf', 'A+B/CV.pdf'] },
  ]);
  assert.deepEqual(resolved, [
    { name: 'Exact', files: ['A+B/CV.pdf'] },
    { name: 'Folder', files: ['A+B/CV.pdf', 'A+B/nested/Letter.pdf'] },
    { name: 'Root', files: ['CV.pdf'] },
    { name: 'Overlap', files: ['A+B/CV.pdf', 'A+B/nested/Letter.pdf'] },
  ]);
});

test('unresolved member files and patterns remain in the generation statistics', async (t) => {
  const { resolved, stats } = await resolveMembers(t, ['nested/Present.pdf'], [
    { name: 'Alice', files: ['nested/Present.pdf', 'Missing.pdf', 'other/*.pdf'] },
    { name: 'Bob', files: ['.', 'Missing.pdf'] },
  ]);
  assert.deepEqual(resolved, [{ name: 'Alice', files: ['nested/Present.pdf'] }]);
  assert.equal(stats.requestedRecipients, 2);
  assert.deepEqual(stats.missingFiles, ['.', 'Missing.pdf', 'other/*.pdf']);
});

test('a completely unresolved member request returns its missing files instead of an empty success', async (t) => {
  const { resolved, stats } = await resolveMembers(t, ['Present.pdf'], [
    { name: 'Alice', files: ['Missing.pdf'] },
  ]);
  assert.deepEqual(resolved, []);
  assert.equal(stats.requestedRecipients, 1);
  assert.equal(stats.processedFiles, 0);
  assert.deepEqual(stats.missingFiles, ['Missing.pdf']);
});
