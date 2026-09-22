import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DashboardCoordinator } from '../dist/app/dashboardCoordinator.js';
import { CsvAssignmentLoader } from '../dist/services/assignments/csvAssignmentLoader.js';
import { DocxTemplateService } from '../dist/services/docx/docxTemplateService.js';
import { ReviewerPreparationService } from '../dist/services/pipeline/reviewerPreparationService.js';
import { WorkspaceService } from '../dist/services/workspace/workspaceService.js';

async function temporaryDirectory(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cac-reviewer-number-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function createProcessor(root) {
  return {
    collectPdfFiles: async () => [{
      relative: 'Candidate.pdf',
      basename: 'Candidate.pdf',
      relativeDir: '',
      absolute: path.join(root, 'Candidate.pdf'),
    }],
    prepare: async (packages) => ({
      requestedRecipients: packages.length,
      processedRecipients: packages.length,
      processedFiles: packages.length,
      missingFiles: [],
      errors: [],
    }),
  };
}

for (const cacType of ['ripec', 'avancement']) {
  test(`${cacType} reports retain reviewer 2 from CSV through the generated DOCX`, async (t) => {
    const root = await temporaryDirectory(t);
    const filename = path.join(root, 'reviewers.csv');
    await writeFile(filename, 'file;Rapporteur 1;Rapporteur 2\nCandidate.pdf;;Zoe\n');
    const coordinator = new DashboardCoordinator(new CsvAssignmentLoader(), new WorkspaceService(), {}, {});
    await coordinator.loadReviewersCsv(filename);
    const templates = new DocxTemplateService();
    const service = new ReviewerPreparationService(createProcessor(root), {}, templates);
    const output = path.join(root, 'output');

    const stats = await service.prepare(
      coordinator.reviewerPackages(), root, output, 'CAC',
      undefined, undefined, undefined, false, undefined, undefined, cacType,
    );

    assert.deepEqual(stats.errors, []);
    const recipientDirectory = path.join(output, 'Zoe', 'CAC');
    const files = await readdir(recipientDirectory);
    assert.equal(files.length, 2);
    const anonymousName = cacType === 'ripec'
      ? 'Rapport RIPEC - Candidate - R2 - Anonyme.docx'
      : 'Rapport Avancement - Candidate - Rapporteur 2.docx';
    assert.ok(files.includes(anonymousName));
    const document = await readFile(path.join(recipientDirectory, anonymousName));
    const xmlEntry = templates.readZipEntries(document).find((entry) => entry.name === 'word/document.xml');
    const text = templates.readEntryData(document, xmlEntry).toString('utf8').replace(/<[^>]+>/g, '');
    assert.match(text, cacType === 'ripec' ? /2 Anonyme/ : /Rapporteur #2/);
  });

  test(`${cacType} fallback numbering reserves explicit numbers before assigning other packages`, async (t) => {
    const root = await temporaryDirectory(t);
    const calls = [];
    const captureReport = async (copy) => { calls.push(copy); return []; };
    const service = new ReviewerPreparationService(createProcessor(root), {}, {
      createRipecReport: captureReport,
      createAvancementReports: captureReport,
    });

    const stats = await service.prepare([
      { name: 'Alice', files: ['Candidate.pdf'] },
      { name: 'Bruno', files: ['Candidate.pdf'], reviewerNumberByFile: { 'candidate.pdf': 1 } },
      { name: 'Claire', files: ['Candidate.pdf'] },
      { name: 'Zoe', files: ['Candidate.pdf'], reviewerNumberByFile: { 'Candidate.pdf': 3 } },
    ], root, path.join(root, 'output'), 'CAC',
    undefined, undefined, undefined, false, undefined, undefined, cacType);

    assert.deepEqual(stats.errors, []);
    assert.deepEqual(Object.fromEntries(calls.map((copy) => [copy.reviewerName, copy.reviewerNumber])), {
      Alice: 2, Bruno: 1, Claire: 4, Zoe: 3,
    });
  });
}
