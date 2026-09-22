import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ReviewerDepositReportService } from '../dist/services/reporting/reviewerDepositReportService.js';

function createZip(entryNames) {
  const localEntries = [];
  const centralEntries = [];
  let offset = 0;
  for (const entryName of entryNames) {
    const name = Buffer.from(entryName, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(name.length, 26);
    localEntries.push(local, name);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralEntries.push(central, name);
    offset += local.length + name.length;
  }
  const directory = Buffer.concat(centralEntries);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entryNames.length, 8);
  end.writeUInt16LE(entryNames.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localEntries, directory, end]);
}

async function generateReport(expectedNames, depositNames) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cac-deposit-report-'));
  try {
    const reviewerDir = path.join(root, 'Martin Alice');
    await mkdir(reviewerDir);
    await writeFile(path.join(reviewerDir, 'CAC - Martin Alice.zip'), createZip(expectedNames));
    await Promise.all(depositNames.map((name) => writeFile(path.join(reviewerDir, name), 'returned report')));
    const result = await new ReviewerDepositReportService().generate(root);
    return { summary: result.summary, html: await readFile(result.reportPath, 'utf8') };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const formats = [
  {
    label: 'RIPEC',
    anonymous: 'Rapport RIPEC - Dupont Jean - R1 - Anonyme.docx',
    named: 'Rapport RIPEC - Dupont Jean - R1 - Martin Alice.docx',
  },
  {
    label: 'Avancement',
    anonymous: 'Rapport Avancement - Dupont Jean - Rapporteur 1.docx',
    named: 'Rapport Avancement - Dupont Jean - Martin Alice.docx',
  },
  {
    label: 'legacy RIPEC',
    anonymous: 'Rapport RIPEC - Dupont Jean - Rapporteur 1.docx',
    named: 'Rapport RIPEC - Dupont Jean - Martin Alice.docx',
  },
];

for (const { label, anonymous, named } of formats) {
  test(`${label}: two anonymous returns cannot satisfy the named report`, async () => {
    const { summary, html } = await generateReport(
      [anonymous, named],
      [anonymous, anonymous.replace('.docx', ' (2).docx')],
    );
    assert.equal(summary.expectedReports, 2);
    assert.equal(summary.matchedReports, 1);
    assert.equal(summary.probableReports, 0);
    assert.equal(summary.missingReports, 1);
    assert.equal(summary.extraDeposits, 1);
    assert.match(html, /class="status-pill status-review"/);
    assert.doesNotMatch(html, /class="status-pill status-complete"/);
  });

  test(`${label}: a DOCX anonymous report and a PDF named report are complete`, async () => {
    const { summary, html } = await generateReport(
      [anonymous, named],
      [anonymous, named.replace('.docx', '.pdf')],
    );
    assert.equal(summary.expectedReports, 2);
    assert.equal(summary.matchedReports, 2);
    assert.equal(summary.probableReports, 0);
    assert.equal(summary.missingReports, 0);
    assert.equal(summary.extraDeposits, 0);
    assert.match(html, /class="status-pill status-complete"/);
  });
}

test('two named returns cannot satisfy the anonymous report', async () => {
  const { anonymous, named } = formats[0];
  const { summary } = await generateReport(
    [anonymous, named],
    [named, named.replace('.docx', ' (2).pdf')],
  );
  assert.equal(summary.matchedReports, 1);
  assert.equal(summary.probableReports, 0);
  assert.equal(summary.missingReports, 1);
  assert.equal(summary.extraDeposits, 1);
});

test('returns with no identifiable variant remain subject to review', async () => {
  const { anonymous, named } = formats[0];
  const { summary, html } = await generateReport(
    [anonymous, named],
    ['Dupont Jean.docx', 'Dupont Jean (2).pdf'],
  );
  assert.equal(summary.matchedReports, 0);
  assert.equal(summary.probableReports, 2);
  assert.match(html, /class="status-pill status-review"/);
  assert.doesNotMatch(html, /class="status-pill status-complete"/);
});

test('synthetic RIPEC variants also require the corresponding return', async () => {
  const { anonymous, named } = formats[0];
  const { summary } = await generateReport([anonymous], [anonymous, named.replace('.docx', '.pdf')]);
  assert.equal(summary.expectedReports, 2);
  assert.equal(summary.matchedReports, 2);
  assert.equal(summary.probableReports, 0);
  assert.equal(summary.missingReports, 0);
});
