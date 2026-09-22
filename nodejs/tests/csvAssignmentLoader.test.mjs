import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import XLSX from 'xlsx';
import { CsvAssignmentLoader } from '../dist/services/assignments/csvAssignmentLoader.js';

async function temporaryDirectory(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cac-import-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function writeWorkbook(filename, rows, hiddenRows = []) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!rows'] = [];
  for (const row of hiddenRows) sheet['!rows'][row] = { hidden: true };
  XLSX.utils.book_append_sheet(workbook, sheet, 'Attributions');
  // The bundled BIFF writer omits row metadata, so use Excel XML for .xls fixtures.
  XLSX.writeFile(workbook, filename, { bookType: filename.endsWith('.xls') ? 'xlml' : 'xlsx' });
}

test('CSV imports keep numbered reviewer columns despite gaps and column order', async (t) => {
  const root = await temporaryDirectory(t);
  const filename = path.join(root, 'reviewers.csv');
  await writeFile(filename, [
    'file;Rapporteur 3;Rapporteur 1;Reviewer 2',
    'Candidate.pdf;Claire;;Bruno',
    'Other.pdf;;Alice;Bruno',
  ].join('\n'));

  const assignments = await new CsvAssignmentLoader().reviewers(filename);

  assert.deepEqual(assignments.map(({ reviewers, reviewerNumbers }) => ({ reviewers, reviewerNumbers })), [
    { reviewers: ['Claire', 'Bruno'], reviewerNumbers: { claire: 3, bruno: 2 } },
    { reviewers: ['Alice', 'Bruno'], reviewerNumbers: { alice: 1, bruno: 2 } },
  ]);
});

test('unnumbered CSV reviewer columns retain their positions when an earlier column is empty', async (t) => {
  const root = await temporaryDirectory(t);
  const filename = path.join(root, 'reviewers.csv');
  await writeFile(filename, 'file;Reviewer primary;Reviewer secondary\nCandidate.pdf;;Bruno\n');

  const [assignment] = await new CsvAssignmentLoader().reviewers(filename);

  assert.deepEqual(assignment.reviewers, ['Bruno']);
  assert.deepEqual(assignment.reviewerNumbers, { bruno: 2 });
});

for (const extension of ['xlsx', 'xls']) {
  const format = extension === 'xls' ? 'xls (SpreadsheetML)' : extension;
  test(`${format} imports exclude hidden candidate rows and keep reviewer column numbers`, async (t) => {
    const root = await temporaryDirectory(t);
    const filename = path.join(root, `reviewers.${extension}`);
    writeWorkbook(filename, [
      ['Nom', 'Prénom', 'Rapporteur 3', 'Rapporteur 1', 'Rapporteur 2'],
      ['Visible', 'Alice', 'Claire', '', 'Bruno'],
      ['Masqué', 'Bob', 'Hidden reviewer', 'Hidden reviewer 2', ''],
      ['Autre', 'Claire', '', 'Alice', ''],
    ], [2]);

    const assignments = await new CsvAssignmentLoader().reviewers(filename);

    assert.deepEqual(assignments.map((entry) => entry.file), ['Visible Alice.pdf', 'Autre Claire.pdf']);
    assert.deepEqual(assignments[0].reviewers, ['Claire', 'Bruno']);
    assert.deepEqual(assignments[0].reviewerNumbers, { claire: 3, bruno: 2 });
    assert.deepEqual(assignments[1].reviewerNumbers, { alice: 1 });
  });

  test(`${format} imports exclude hidden member rows`, async (t) => {
    const root = await temporaryDirectory(t);
    const filename = path.join(root, `members.${extension}`);
    writeWorkbook(filename, [
      ['Nom', 'Fichier'],
      ['Visible member', 'Visible.pdf'],
      ['Hidden member', 'Hidden.pdf'],
      ['Other member', 'Other.pdf'],
    ], [2]);

    const assignments = await new CsvAssignmentLoader().members(filename);

    assert.deepEqual(assignments, [
      { name: 'Visible member', files: ['Visible.pdf'], source: 'csv' },
      { name: 'Other member', files: ['Other.pdf'], source: 'csv' },
    ]);
  });
}
