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

async function memberImportFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cac-member-import-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const mcf = path.join(root, 'mcf.csv');
  const pr = path.join(root, 'pr.csv');
  await writeFile(mcf, 'Membre;Fichier\nExemple-Membre Prénom-Composé;MCF.pdf\n');
  await writeFile(pr, 'Membre;Fichier\nMembre PR;PR.pdf\n');
  return { root, mcf, pr };
}

test('a new member list replaces MCF with PR for generation and stays replaced after folder refresh', async (t) => {
  const { root, mcf, pr } = await memberImportFixture(t);
  const runs = [];
  const workspace = new WorkspaceService();
  workspace.resolveOutputPath = async () => path.join(root, 'output');
  const service = { async prepare(entries) {
    runs.push(entries);
    return { requestedRecipients: entries.length, processedRecipients: entries.length, processedFiles: entries.length, missingFiles: [], errors: [] };
  } };
  const coordinator = new DashboardCoordinator(new CsvAssignmentLoader(), workspace, {}, service);
  await coordinator.setFolder(root);
  coordinator.cacName = 'CAC';
  await coordinator.loadMembersCsv(mcf);
  await coordinator.loadMembersCsv(pr);
  assert.deepEqual(coordinator.csvMembers, [pr]);
  assert.deepEqual(coordinator.membersFromCsv.map(({ name }) => name), ['Membre PR']);

  await coordinator.setFolder(root);
  assert.deepEqual(coordinator.csvMembers, [pr]);
  assert.deepEqual(coordinator.membersFromCsv.map(({ name }) => name), ['Membre PR']);
  await coordinator.executeRun('members');
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0], [{ name: 'Membre PR', files: ['PR.pdf'] }]);
});

test('explicit member append merges sources and reloading a file does not duplicate members', async (t) => {
  const { mcf, pr } = await memberImportFixture(t);
  const coordinator = createCoordinator();
  await coordinator.loadMembersCsv(mcf);
  await coordinator.loadMembersCsv(pr, 'append');
  await coordinator.loadMembersCsv(pr, 'append');
  assert.deepEqual(coordinator.csvMembers, [mcf, pr]);
  assert.deepEqual(coordinator.membersFromCsv.map(({ name }) => name), ['Exemple-Membre Prénom-Composé', 'Membre PR']);

  await writeFile(pr, 'Membre;Fichier\nExemple-Membre Prénom-Composé;PR.pdf\n');
  await coordinator.loadMembersCsv(pr, 'append');
  assert.deepEqual(coordinator.membersFromCsv, [{
    name: 'Exemple-Membre Prénom-Composé', files: ['MCF.pdf', 'PR.pdf'], source: 'csv',
  }]);
});

test('replacing imported members retains separate manual assignments', async (t) => {
  const { mcf, pr } = await memberImportFixture(t);
  const coordinator = createCoordinator();
  await coordinator.loadMembersCsv(mcf);
  coordinator.addManualMember('Membre manuel', 'Manuel.pdf');
  await coordinator.loadMembersCsv(pr);
  assert.deepEqual(coordinator.membersFromCsv.map(({ name }) => name), ['Membre PR']);
  assert.deepEqual(coordinator.membersManual, [{ name: 'Membre manuel', files: ['Manuel.pdf'], source: 'manual' }]);
  assert.deepEqual(coordinator.combinedMembers().map(({ name }) => name), ['Membre PR', 'Membre manuel']);
});

for (const mode of ['replace', 'append']) {
  test(`unreadable ${mode} member import rejects without changing the active list`, async (t) => {
    const { root, mcf } = await memberImportFixture(t);
    const coordinator = createCoordinator();
    await coordinator.loadMembersCsv(mcf);
    const before = structuredClone(coordinator.membersFromCsv);
    await assert.rejects(() => coordinator.loadMembersCsv(path.join(root, 'missing.csv'), mode), /La liste active reste inchangée/);
    assert.deepEqual(coordinator.csvMembers, [mcf]);
    assert.deepEqual(coordinator.membersFromCsv, before);
    await coordinator.setFolder(root);
    assert.deepEqual(coordinator.membersFromCsv, before);
  });
}

test('an empty new member file clears the imported list instead of running the old list', async (t) => {
  const { mcf, pr } = await memberImportFixture(t);
  const coordinator = createCoordinator();
  await coordinator.loadMembersCsv(mcf);
  await writeFile(pr, 'Membre;Fichier\n');
  await coordinator.loadMembersCsv(pr);
  assert.deepEqual(coordinator.csvMembers, [pr]);
  assert.deepEqual(coordinator.membersFromCsv, []);
  assert.equal(coordinator.getCanRunMembers(), false);
});

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

for (const mode of ['members', 'reviewers']) {
  test(`${mode} completion exposes missing PDFs instead of reporting success`, async () => {
    const stats = { requestedRecipients: 1, processedRecipients: 0, processedFiles: 0, missingFiles: ['Missing.pdf'], errors: [] };
    const service = { async prepare() { return stats; } };
    const workspace = { async resolveOutputPath() { return '/unused/output'; } };
    const coordinator = new DashboardCoordinator(new CsvAssignmentLoader(), workspace, service, service);
    coordinator.folder = '/unused/source';
    coordinator.cacName = 'CAC';
    coordinator.membersManual = [{ name: 'Alice', files: ['Missing.pdf'], source: 'manual' }];
    coordinator.reviewersManual = [{ file: 'Missing.pdf', reviewers: ['Alice'], source: 'manual' }];
    await coordinator.executeRun(mode);
    assert.equal(coordinator.status, 'Terminé avec erreurs');
    assert.equal(coordinator.lastRunStats.missing, 1);
    assert.equal(coordinator.lastRunStats.files, 0);
    assert.equal(coordinator.runErrors.length, 1);
    assert.match(coordinator.runErrors[0], /Missing\.pdf/);
    assert.match(coordinator.runErrors[0], /Aucun PDF généré/);
    assert.doesNotMatch(coordinator.log, /terminé avec succès/);
  });
}
