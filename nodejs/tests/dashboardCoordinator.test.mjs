import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DashboardCoordinator } from '../dist/app/dashboardCoordinator.js';
import { CsvAssignmentLoader } from '../dist/services/assignments/csvAssignmentLoader.js';
import { WorkspaceService } from '../dist/services/workspace/workspaceService.js';

function createCoordinator() {
  return new DashboardCoordinator(new CsvAssignmentLoader(), new WorkspaceService(), {}, {});
}

function packageNumbers(coordinator, file) {
  return Object.fromEntries(coordinator.reviewerPackages()
    .filter((pkg) => pkg.files.some((candidate) => candidate.toLowerCase() === file.toLowerCase()))
    .map((pkg) => [pkg.name, pkg.reviewerNumberByFile[file.toLowerCase()]]));
}

test('merged imports preserve original reviewer numbers across reloads', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cac-coordinator-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const secondReviewerFile = path.join(root, 'second.csv');
  const firstReviewerFile = path.join(root, 'first.csv');
  await writeFile(secondReviewerFile, 'file;Rapporteur 1;Rapporteur 2\nCandidate.pdf;;Zoe\n');
  await writeFile(firstReviewerFile, 'file;Rapporteur 1;Rapporteur 2\ncandidate.pdf;Alice;\n');
  const coordinator = createCoordinator();

  await coordinator.loadReviewersCsv(secondReviewerFile);
  assert.deepEqual(packageNumbers(coordinator, 'Candidate.pdf'), { Zoe: 2 });
  await coordinator.loadReviewersCsv(firstReviewerFile);
  assert.equal(coordinator.reviewersFromCsv.length, 1);
  assert.deepEqual(packageNumbers(coordinator, 'Candidate.pdf'), { Alice: 1, Zoe: 2 });
  await coordinator.loadReviewersCsv(secondReviewerFile);
  assert.deepEqual(packageNumbers(coordinator, 'Candidate.pdf'), { Alice: 1, Zoe: 2 });
});

test('legacy and manual assignments use free numbers while preserving explicit numbers', () => {
  const coordinator = createCoordinator();
  coordinator.reviewersFromCsv = [
    { file: 'Candidate.pdf', reviewers: ['Zoe'], reviewerNumbers: { zoe: 2 }, source: 'csv' },
    { file: 'Candidate.pdf', reviewers: ['Alice', 'Zoe'], source: 'csv' },
  ];
  coordinator.reviewersManual = [
    { file: 'Candidate.pdf', reviewers: ['Bruno', 'ALICE'], source: 'manual' },
    { file: 'Other.pdf', reviewers: ['Zoe', 'Alice'], source: 'manual' },
  ];

  assert.deepEqual(packageNumbers(coordinator, 'Candidate.pdf'), { Alice: 1, Bruno: 3, Zoe: 2 });
  assert.deepEqual(packageNumbers(coordinator, 'Other.pdf'), { Alice: 2, Zoe: 1 });
});
