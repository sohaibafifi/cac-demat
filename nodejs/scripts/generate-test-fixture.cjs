#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const XLSX = require('xlsx');

const ROOT = path.resolve(__dirname, '..');
const GENERATED_ROOT = path.join(ROOT, 'test-data', 'generated');

const LAST_NAMES = [
  'Dupont', 'Martin', 'Bernard', 'Petit', 'Robert', 'Richard', 'Durand', 'Leroy',
  'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Garcia', 'David', 'Bertrand', 'Roux',
  'Vincent', 'Fournier', 'Morel', 'Girard', 'Andre', 'Mercier', 'Blanc', 'Guerin',
  'Boyer', 'Garnier', 'Chevalier', 'Faure', 'Muller', 'Robin', 'Aubry', 'Leclerc',
  'Renaud', 'Colin', 'Perrot', 'Navarro', "O'Neil", 'Dufour', 'Noel', 'Meyer',
  'Caron', 'Besson', 'Mathieu', 'Roussel', 'Lemaire', 'Philippe', 'Lopez', 'Julien',
];

const FIRST_NAMES = [
  'Jean', 'Marie', 'Paul', 'Claire', 'Nicolas', 'Sophie', 'Luc', 'Camille',
  'Julien', 'Elodie', 'Anne-Marie', 'Hugo', 'Louise', 'Yanis', 'Lina', 'Theo',
  'Ines', 'Chloe', 'Noah', 'Emma', 'Lucas', 'Sarah', 'Nora', 'Tom',
  'Alice', 'Leo', 'Mila', 'Nathan', 'Eva', 'Louis', 'Jade', 'Arthur',
  'Lea', 'Marius', 'Manon', 'Gabriel', 'Jeanne', 'Axel', 'Rose', 'Adam',
  'Maya', 'Victor', 'Iris', 'Evan', 'Louna', 'Raphael', 'Clara', 'Sacha',
];

const parseArgs = (argv) => {
  const options = {
    profile: 'rich',
    candidates: 40,
    members: 20,
    reviewers: 20,
    name: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const nextValue = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${token}`);
      }
      index += 1;
      return value;
    };

    if (token === '--profile') {
      options.profile = nextValue();
      continue;
    }

    if (token === '--candidates') {
      options.candidates = parsePositiveInteger(nextValue(), 'candidates');
      continue;
    }

    if (token === '--members') {
      options.members = parsePositiveInteger(nextValue(), 'members');
      continue;
    }

    if (token === '--reviewers') {
      options.reviewers = parsePositiveInteger(nextValue(), 'reviewers');
      continue;
    }

    if (token === '--name') {
      options.name = nextValue();
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!['rich', 'performance'].includes(options.profile)) {
    throw new Error(`Unsupported profile: ${options.profile}`);
  }

  return options;
};

const parsePositiveInteger = (value, label) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
};

const execFileAsync = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || stdout?.trim() || error.message));
        return;
      }
      resolve({ stdout, stderr });
    });
  });

const escapePdfText = (value) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');

const buildPdf = (lines) => {
  const sanitizedLines = lines.map((line) => escapePdfText(line));
  const content = [
    'BT',
    '/F1 14 Tf',
    '18 TL',
    '1 0 0 1 72 760 Tm',
    ...sanitizedLines.flatMap((line, index) => (index === 0 ? [`(${line}) Tj`] : ['T*', `(${line}) Tj`])),
    'ET',
    '',
  ].join('\n');

  const objects = [
    '',
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let document = '%PDF-1.4\n';
  const offsets = [0];

  for (let index = 1; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(document, 'utf8'));
    document += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(document, 'utf8');
  document += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;

  for (let index = 1; index < objects.length; index += 1) {
    document += `${offsets[index].toString().padStart(10, '0')} 00000 n \n`;
  }

  document += `trailer\n<< /Root 1 0 R /Size ${objects.length} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return document;
};

const buildRtf = (lines) =>
  `{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Helvetica;}}\\f0\\fs24 ${lines
    .map((line) => line.replace(/[{}\\]/g, ' '))
    .join('\\par ')}\\par}`;

const writePdf = async (pathname, lines) => {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.writeFile(pathname, buildPdf(lines), 'utf8');
};

const writeText = async (pathname, contents) => {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.writeFile(pathname, contents, 'utf8');
};

const writeWorkbook = async (pathname, rows, hiddenRowIndexes = []) => {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);

  if (hiddenRowIndexes.length > 0) {
    worksheet['!rows'] = rows.map((_row, index) => ({ hidden: hiddenRowIndexes.includes(index) }));
  }

  XLSX.utils.book_append_sheet(workbook, worksheet, 'Feuille 1');
  XLSX.writeFile(workbook, pathname);
};

const commandExists = async (command) => {
  const candidates = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean)
      : [''];

  for (const dir of candidates) {
    for (const ext of extensions) {
      const pathname = path.join(dir, process.platform === 'win32' && ext ? `${command}${ext}` : command);
      try {
        await fs.access(pathname);
        return pathname;
      } catch {
        // continue
      }
    }
  }

  return null;
};

const createDocxIfPossible = async (pathname, contents, textutilPath) => {
  if (!textutilPath) {
    return false;
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cac-docx-fixture-'));
  const sourceTxt = path.join(tempDir, 'source.txt');

  try {
    await fs.writeFile(sourceTxt, contents, 'utf8');
    await fs.mkdir(path.dirname(pathname), { recursive: true });
    await execFileAsync(textutilPath, ['-convert', 'docx', sourceTxt, '-output', pathname]);
    return true;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
};

const buildRichReadme = (hasDocx) => `# Rich Test Fixture

Ce dossier est genere automatiquement par \`npm run generate:test-fixture\`.

## Contenu principal

- \`source/\` contient des PDFs a la racine et dans des sous-dossiers
- \`source/Docs/\` contient des documents a convertir (${hasDocx ? 'RTF + DOCX' : 'RTF seulement'})
- plusieurs noms incluent accents, apostrophes et espaces
- \`root_only_sensitive.pdf\` contient une sequence sensible pour valider le nettoyage

## Imports rapporteurs

- \`imports/reviewers/reviewers_exact.csv\` : chemins explicites
- \`imports/reviewers/reviewers_matching.xlsx\` : appariement nom/prenom
- \`imports/reviewers/reviewers_missing.xlsx\` : candidat absent pour tester les manquants

## Imports membres

- \`imports/members/members_main.csv\` : tous les fichiers, racine \`.\`, dossier, joker, reference par nom
- \`imports/members/members_merge.csv\` : fusion insensible a la casse, doublons, reference manquante
- \`imports/members/members.xlsx\` : import Excel avec lignes masquees
- \`imports/members/members_list_only.csv\` : variante liste simple sans colonne membre
`;

const buildPerformanceReadme = (summary) => `# Performance Test Fixture

Ce dossier est genere automatiquement par \`npm run generate:perf-fixture\`.

## Volume

- candidats : ${summary.candidateCount}
- membres : ${summary.memberCount}
- rapporteurs : ${summary.reviewerCount}
- fichiers sources supportes : ${summary.supportedSourceFileCount}

## Contenu

- un melange de PDF, RTF et ${summary.docxCreatedCount > 0 ? 'DOCX' : 'documents sans DOCX'}
- plusieurs sous-dossiers pour les tests de repertoire et de jokers
- \`imports/reviewers/reviewers_exact.csv\` pour les chemins explicites
- \`imports/reviewers/reviewers_matching.xlsx\` pour le matching nom/prenom
- \`imports/members/members_all_files.csv\` pour un test de charge maximal
- \`imports/members/members_mixed.csv\` pour les references racine, dossiers, jokers et noms
`;

const getOutputRoot = (options) => {
  if (options.name) {
    return path.join(GENERATED_ROOT, options.name);
  }

  if (options.profile === 'performance') {
    return path.join(
      GENERATED_ROOT,
      `performance-${options.candidates}c-${options.members}m-${options.reviewers}r`,
    );
  }

  return path.join(GENERATED_ROOT, 'rich-fixture');
};

const createRichFixture = async (outputRoot, textutilPath) => {
  const sourceRoot = path.join(outputRoot, 'source');
  const importsRoot = path.join(outputRoot, 'imports');

  await fs.rm(outputRoot, { recursive: true, force: true });
  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.mkdir(importsRoot, { recursive: true });

  await writePdf(path.join(sourceRoot, 'Dupont Jean.pdf'), [
    'Fixture CAC Demat',
    'Candidate: Dupont Jean',
    'This file exercises reviewer matching.',
  ]);

  await writePdf(path.join(sourceRoot, 'Martin Marie.pdf'), [
    'Fixture CAC Demat',
    'Candidate: Martin Marie',
    'This file exercises reviewer matching.',
  ]);

  await writePdf(path.join(sourceRoot, "O'Neil Anne-Marie.pdf"), [
    'Fixture CAC Demat',
    "Candidate: O'Neil Anne-Marie",
    'This file exercises apostrophes and dashes.',
  ]);

  await writePdf(path.join(sourceRoot, 'root_only_sensitive.pdf'), [
    'Fixture CAC Demat',
    'Sensitive token for CleanStage',
    '12 G 34 12345 ABC',
  ]);

  await writePdf(path.join(sourceRoot, 'sample_1', 'Candidat special.pdf'), [
    'Fixture CAC Demat',
    'Folder match sample_1/',
    'Used by member folder assignment.',
  ]);

  await writePdf(path.join(sourceRoot, 'sample_1', 'nested', 'These notes.pdf'), [
    'Fixture CAC Demat',
    'Nested file inside sample_1/nested',
    'Wildcard sample_*/*.pdf should not catch this one.',
  ]);

  await writePdf(path.join(sourceRoot, 'sample_2', 'Rapport final.pdf'), [
    'Fixture CAC Demat',
    'Folder match sample_2/',
    'Used by wildcard and folder references.',
  ]);

  await writePdf(path.join(sourceRoot, 'sample_3', 'Elodie Dufour.pdf'), [
    'Fixture CAC Demat',
    'Candidate: Elodie Dufour',
    'Used for accent-insensitive matching from spreadsheets.',
  ]);

  await writeText(
    path.join(sourceRoot, 'Docs', 'Notice conversion.rtf'),
    buildRtf([
      'Fixture CAC Demat',
      'Document RTF de test',
      'Conversion partagee entre membres.',
    ]),
  );

  const docxCreated = await createDocxIfPossible(
    path.join(sourceRoot, 'Docs', 'Guide membres.docx'),
    'Fixture CAC Demat\n\nDocument DOCX de test pour la conversion partagee entre membres.\n',
    textutilPath,
  );

  const reviewersDir = path.join(importsRoot, 'reviewers');
  const membersDir = path.join(importsRoot, 'members');
  await fs.mkdir(reviewersDir, { recursive: true });
  await fs.mkdir(membersDir, { recursive: true });

  await writeText(
    path.join(reviewersDir, 'reviewers_exact.csv'),
    [
      'file;reviewer 1;reviewer 2',
      'Dupont Jean.pdf;Rapporteur A;Rapporteur B',
      'sample_1/Candidat special.pdf;Rapporteur C;',
      `Docs/${docxCreated ? 'Guide membres.docx' : 'Notice conversion.rtf'};Rapporteur D;`,
    ].join('\n'),
  );

  await writeWorkbook(
    path.join(reviewersDir, 'reviewers_matching.xlsx'),
    [
      ['Nom d\'usage', 'Prenom', 'Rapporteur 1', 'Rapporteur 2'],
      ['Dupont', 'Jean', 'Rapporteur A', 'Rapporteur B'],
      ['Martin', 'Marie', 'Rapporteur C', ''],
      ["O'Neil", 'Anne-Marie', 'Rapporteur D', 'Rapporteur E'],
      ['Dufour', 'Elodie', 'Rapporteur F', ''],
      ['Ligne cachee', 'Invisible', 'Rapporteur X', ''],
    ],
    [5],
  );

  await writeWorkbook(
    path.join(reviewersDir, 'reviewers_missing.xlsx'),
    [
      ['Nom', 'Prenom', 'Rapporteur 1'],
      ['Dupont', 'Jean', 'Rapporteur A'],
      ['Fantome', 'Alice', 'Rapporteur Z'],
    ],
  );

  await writeText(
    path.join(membersDir, 'members_main.csv'),
    [
      'Membre;Fichier 1;Fichier 2;Fichier 3',
      'Membre Tous;;;',
      'Membre Racine;.;;',
      'Membre Dossier;sample_1/;Docs/;',
      'Membre Motif;sample_*/*.pdf;;',
      'Membre Nom;Anne-Marie O\'Neil;;',
      `Membre Mixte;Dupont Jean.pdf;sample_2/;Docs/${docxCreated ? 'Guide membres.docx' : 'Notice conversion.rtf'}`,
    ].join('\n'),
  );

  await writeText(
    path.join(membersDir, 'members_merge.csv'),
    [
      'Member;Reference 1;Reference 2',
      'Membre Fusion;Dupont Jean.pdf;sample_1/',
      'membre fusion;Docs/;',
      'Membre Doublon;sample_2/Rapport final.pdf;sample_2/Rapport final.pdf',
      'Membre Manquant;missing-file.pdf;',
    ].join('\n'),
  );

  await writeWorkbook(
    path.join(membersDir, 'members.xlsx'),
    [
      ['Nom', 'Reference 1', 'Reference 2'],
      ['Membre Excel', 'Docs/', '.'],
      ['Membre Excel', 'sample_2/', 'Elodie Dufour'],
      ['Membre Nom Excel', 'Martin Marie', ''],
      ['Ligne cachee', 'sample_1/', ''],
    ],
    [4],
  );

  await writeText(
    path.join(membersDir, 'members_list_only.csv'),
    [
      'Alice Membres;Bob Membres',
      'Claire Membres;',
    ].join('\n'),
  );

  await writeText(path.join(outputRoot, 'README.md'), buildRichReadme(docxCreated));
  return {
    outputRoot,
    candidateCount: 4,
    memberCount: 6,
    reviewerCount: 6,
    supportedSourceFileCount: docxCreated ? 10 : 9,
    docxCreatedCount: docxCreated ? 1 : 0,
  };
};

const buildCandidateEntries = (count, docxAvailable) => {
  const folderCycle = ['', 'batch_1', 'batch_2', 'batch_3', 'batch_4', 'batch_1/nested', 'batch_2/nested'];
  const entries = [];
  let docxBudget = docxAvailable ? Math.max(1, Math.floor(count / 5)) : 0;
  let rtfBudget = Math.max(1, Math.floor(count / 5));

  for (let index = 0; index < count; index += 1) {
    const lastName = LAST_NAMES[index % LAST_NAMES.length];
    const firstName = FIRST_NAMES[index % FIRST_NAMES.length];
    let extension = '.pdf';

    if (docxBudget > 0 && index % 5 === 0) {
      extension = '.docx';
      docxBudget -= 1;
    } else if (rtfBudget > 0 && index % 5 === 1) {
      extension = '.rtf';
      rtfBudget -= 1;
    }

    const folder = folderCycle[index % folderCycle.length];
    const displayName = `${lastName} ${firstName}`;
    const relativePath = path.posix.join(folder, `${displayName}${extension}`).replace(/^\//, '');

    entries.push({
      index,
      firstName,
      lastName,
      displayName,
      folder,
      extension,
      relativePath,
      includeSensitiveToken: index === 0,
    });
  }

  return entries;
};

const buildReviewerPool = (count) =>
  Array.from({ length: count }, (_value, index) => `Rapporteur ${String(index + 1).padStart(2, '0')}`);

const buildMemberPool = (count) =>
  Array.from({ length: count }, (_value, index) => `Membre ${String(index + 1).padStart(2, '0')}`);

const buildSharedEntries = (docxAvailable) => {
  const entries = [
    {
      relativePath: 'shared/Guide procedure.pdf',
      extension: '.pdf',
      lines: ['Shared document', 'Guide procedure', 'Used by member all-files tests.'],
    },
    {
      relativePath: 'shared/Grille evaluation.rtf',
      extension: '.rtf',
      lines: ['Shared document', 'Grille evaluation', 'Used by document conversion tests.'],
    },
    {
      relativePath: 'shared/Note de cadrage.pdf',
      extension: '.pdf',
      lines: ['Shared document', 'Note de cadrage', 'Used by member all-files tests.'],
    },
  ];

  if (docxAvailable) {
    entries.push({
      relativePath: 'shared/Convocation.docx',
      extension: '.docx',
      lines: ['Shared document', 'Convocation', 'DOCX file for conversion cache tests.'],
    });
  }

  return entries;
};

const writeEntry = async (sourceRoot, entry, textutilPath) => {
  const pathname = path.join(sourceRoot, entry.relativePath);
  const lines = [
    'Fixture CAC Demat',
    `Candidate: ${entry.displayName ?? entry.relativePath}`,
    `Relative path: ${entry.relativePath}`,
  ];

  if (entry.includeSensitiveToken) {
    lines.push('Sensitive token: 12 G 34 12345 ABC');
  }

  if (entry.extension === '.pdf') {
    await writePdf(pathname, lines);
    return true;
  }

  if (entry.extension === '.rtf') {
    await writeText(pathname, buildRtf(lines));
    return true;
  }

  if (entry.extension === '.docx') {
    const text = `${lines.join('\n')}\n`;
    const created = await createDocxIfPossible(pathname, text, textutilPath);
    if (created) {
      return true;
    }

    const fallbackPath = pathname.replace(/\.docx$/i, '.rtf');
    await writeText(fallbackPath, buildRtf(lines));
    entry.extension = '.rtf';
    entry.relativePath = entry.relativePath.replace(/\.docx$/i, '.rtf');
    return false;
  }

  throw new Error(`Unsupported extension for fixture entry: ${entry.extension}`);
};

const createPerformanceFixture = async (outputRoot, options, textutilPath) => {
  const sourceRoot = path.join(outputRoot, 'source');
  const importsRoot = path.join(outputRoot, 'imports');

  await fs.rm(outputRoot, { recursive: true, force: true });
  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.mkdir(importsRoot, { recursive: true });

  const candidateEntries = buildCandidateEntries(options.candidates, Boolean(textutilPath));
  let docxCreatedCount = 0;

  for (const entry of candidateEntries) {
    const createdAsDocx = await writeEntry(sourceRoot, entry, textutilPath);
    if (createdAsDocx && entry.extension === '.docx') {
      docxCreatedCount += 1;
    }
  }

  const sharedEntries = buildSharedEntries(Boolean(textutilPath));
  for (const entry of sharedEntries) {
    const createdAsDocx = await writeEntry(
      sourceRoot,
      {
        ...entry,
        displayName: path.basename(entry.relativePath, entry.extension),
      },
      textutilPath,
    );
    if (createdAsDocx && entry.extension === '.docx') {
      docxCreatedCount += 1;
    }
  }

  const reviewerPool = buildReviewerPool(options.reviewers);
  const memberPool = buildMemberPool(options.members);

  const reviewersDir = path.join(importsRoot, 'reviewers');
  const membersDir = path.join(importsRoot, 'members');
  await fs.mkdir(reviewersDir, { recursive: true });
  await fs.mkdir(membersDir, { recursive: true });

  const exactReviewerRows = ['file;reviewer 1;reviewer 2'];
  for (let index = 0; index < candidateEntries.length; index += 1) {
    const reviewerOne = reviewerPool[index % reviewerPool.length];
    const reviewerTwo = reviewerPool[(index + 7) % reviewerPool.length];
    exactReviewerRows.push(`${candidateEntries[index].relativePath};${reviewerOne};${reviewerTwo}`);
  }

  await writeText(path.join(reviewersDir, 'reviewers_exact.csv'), exactReviewerRows.join('\n'));

  const reviewerWorkbookRows = [['Nom d\'usage', 'Prenom', 'Rapporteur 1', 'Rapporteur 2']];
  for (let index = 0; index < candidateEntries.length; index += 1) {
    const candidate = candidateEntries[index];
    reviewerWorkbookRows.push([
      candidate.lastName,
      candidate.firstName,
      reviewerPool[index % reviewerPool.length],
      reviewerPool[(index + 3) % reviewerPool.length],
    ]);
  }
  await writeWorkbook(path.join(reviewersDir, 'reviewers_matching.xlsx'), reviewerWorkbookRows);

  await writeWorkbook(
    path.join(reviewersDir, 'reviewers_missing.xlsx'),
    [
      ['Nom', 'Prenom', 'Rapporteur 1'],
      [candidateEntries[0].lastName, candidateEntries[0].firstName, reviewerPool[0]],
      ['Fantome', 'Performance', reviewerPool[1]],
    ],
  );

  const membersAllFilesRows = ['Membre;Fichier 1;Fichier 2'];
  for (const memberName of memberPool) {
    membersAllFilesRows.push(`${memberName};;`);
  }
  await writeText(path.join(membersDir, 'members_all_files.csv'), membersAllFilesRows.join('\n'));

  const mixedReferencePool = [
    '.',
    'batch_1/',
    'batch_2/',
    'batch_3/',
    'batch_4/',
    'shared/',
    'batch_*/*.pdf',
    '*.pdf',
    candidateEntries[0].displayName,
    candidateEntries[Math.min(5, candidateEntries.length - 1)].displayName,
    candidateEntries[Math.min(10, candidateEntries.length - 1)].relativePath,
    sharedEntries[0].relativePath,
  ];

  const membersMixedRows = ['Membre;Reference 1;Reference 2;Reference 3'];
  for (let index = 0; index < memberPool.length; index += 1) {
    membersMixedRows.push(
      [
        memberPool[index],
        mixedReferencePool[index % mixedReferencePool.length],
        mixedReferencePool[(index + 4) % mixedReferencePool.length],
        index % 3 === 0 ? candidateEntries[(index * 2) % candidateEntries.length].displayName : '',
      ].join(';'),
    );
  }
  await writeText(path.join(membersDir, 'members_mixed.csv'), membersMixedRows.join('\n'));

  const memberWorkbookRows = [['Nom', 'Reference 1', 'Reference 2']];
  for (let index = 0; index < memberPool.length; index += 1) {
    memberWorkbookRows.push([
      memberPool[index],
      index % 2 === 0 ? '.' : `batch_${(index % 4) + 1}/`,
      index % 5 === 0 ? candidateEntries[index % candidateEntries.length].displayName : 'shared/',
    ]);
  }
  await writeWorkbook(path.join(membersDir, 'members_performance.xlsx'), memberWorkbookRows);

  const summary = {
    outputRoot,
    candidateCount: candidateEntries.length,
    memberCount: memberPool.length,
    reviewerCount: reviewerPool.length,
    supportedSourceFileCount: candidateEntries.length + sharedEntries.length,
    docxCreatedCount,
  };

  await writeText(path.join(outputRoot, 'README.md'), buildPerformanceReadme(summary));
  return summary;
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outputRoot = getOutputRoot(options);
  const textutilPath = await commandExists('textutil');

  const summary =
    options.profile === 'performance'
      ? await createPerformanceFixture(outputRoot, options, textutilPath)
      : await createRichFixture(outputRoot, textutilPath);

  console.log(`Fixture generated in ${summary.outputRoot}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
