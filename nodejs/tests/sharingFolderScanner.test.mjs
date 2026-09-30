import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deriveOwnCloudUsername, SharingFolderScanner } from '../dist/services/sharing/sharingFolderScanner.js';
import { NameSanitizer } from '../dist/support/text/nameSanitizer.js';

// All identities below are deliberately fictitious test labels.
test('SharingFolderScanner returns only recipient directories in locale order', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cac-sharing-scan-'));
  try {
    await Promise.all([
      mkdir(path.join(root, 'FAMILLEZEXEMPLE Prénomtest')),
      mkdir(path.join(root, 'FAMILLEAEXEMPLE Prénomtest')),
      mkdir(path.join(root, '.cache')),
      mkdir(path.join(root, 'node_modules')),
      writeFile(path.join(root, 'README.txt'), 'ignored'),
    ]);

    const recipients = await new SharingFolderScanner().scan(root);

    assert.deepEqual(recipients.map((recipient) => recipient.name), [
      'FAMILLEAEXEMPLE Prénomtest',
      'FAMILLEZEXEMPLE Prénomtest',
    ]);
    assert.equal(recipients[0].absolutePath, path.join(root, 'FAMILLEAEXEMPLE Prénomtest'));
    assert.equal(recipients[0].suggestedUsername, 'prenomtest.familleaexemple');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('deriveOwnCloudUsername moves a distinguishable uppercase family name after the given name', () => {
  assert.equal(deriveOwnCloudUsername('FAMILLEEXEMPLE_Prénomexemple'), 'prenomexemple.familleexemple');
  assert.equal(deriveOwnCloudUsername('FAMILLE-TEST_Prénom-Composé'), 'prenomcompose.familletest');
  assert.equal(deriveOwnCloudUsername('FAMILLEÉXEMPLE_Prénomtest'), 'prenomtest.familleexemple');
  assert.equal(deriveOwnCloudUsername('FAMILLEEXEMPLE prénomtest'), 'prenomtest.familleexemple');
});

test('deriveOwnCloudUsername preserves given-first names with an uppercase family name', () => {
  assert.equal(deriveOwnCloudUsername('Prénomexemple_FAMILLEEXEMPLE'), 'prenomexemple.familleexemple');
  assert.equal(deriveOwnCloudUsername('Prénom-Composé_FAMILLE-TEST'), 'prenomcompose.familletest');
});

test('deriveOwnCloudUsername treats fully uppercase names as surname-first', () => {
  assert.equal(deriveOwnCloudUsername('FAMILLEEXEMPLE_PRENOMEXEMPLE'), 'prenomexemple.familleexemple');
  assert.equal(deriveOwnCloudUsername('FAMILLE-TEST_PRÉNOM-COMPOSÉ'), 'prenomcompose.familletest');
  assert.equal(deriveOwnCloudUsername('FAMILLEÉXEMPLE_PRÉNOMTEST'), 'prenomtest.familleexemple');
  assert.equal(deriveOwnCloudUsername('P_PRENOMEXEMPLE'), 'prenomexemple.p');
});

test('deriveOwnCloudUsername takes the last uppercase token as the given name and groups preceding family parts', () => {
  assert.equal(deriveOwnCloudUsername('DE_LA_FAMILLEEXEMPLE_PRENOMTEST'), 'prenomtest.delafamilleexemple');
  assert.equal(deriveOwnCloudUsername('DE LA FAMILLEEXEMPLE PRÉNOM-COMPOSÉ'), 'prenomcompose.delafamilleexemple');
  assert.equal(deriveOwnCloudUsername('D_EXEMPLE_PRENOMTEST'), 'prenomtest.dexemple');
});

test('deriveOwnCloudUsername joins distinguishable multiword family names in either order', () => {
  assert.equal(deriveOwnCloudUsername('DE_LA_FAMILLEEXEMPLE_Prénomtest'), 'prenomtest.delafamilleexemple');
  assert.equal(deriveOwnCloudUsername('Prénomtest_DE_LA_FAMILLEEXEMPLE'), 'prenomtest.delafamilleexemple');
  assert.equal(deriveOwnCloudUsername('FAMILLE_EXEMPLE_Prénomtest'), 'prenomtest.familleexemple');
});

test('deriveOwnCloudUsername supports apostrophes before and after directory sanitization', () => {
  for (const name of ['D’EXEMPLE Prénomtest', "D'EXEMPLE Prénomtest"]) {
    assert.equal(deriveOwnCloudUsername(name), 'prenomtest.dexemple');
    assert.equal(deriveOwnCloudUsername(NameSanitizer.sanitize(name, 'reviewer')), 'prenomtest.dexemple');
  }
  assert.equal(
    deriveOwnCloudUsername(NameSanitizer.sanitize('Prénomtest D’EXEMPLE', 'member')),
    'prenomtest.dexemple',
  );
});

test('deriveOwnCloudUsername preserves existing dotted identifiers regardless of capitalization', () => {
  assert.equal(deriveOwnCloudUsername('prenomexemple.familleexemple'), 'prenomexemple.familleexemple');
  assert.equal(deriveOwnCloudUsername('FAMILLEEXEMPLE.Prénomexemple'), 'familleexemple.prenomexemple');
  assert.equal(deriveOwnCloudUsername('Prénomexemple.FAMILLEEXEMPLE'), 'prenomexemple.familleexemple');
  assert.equal(deriveOwnCloudUsername('PRENOMEXEMPLE.FAMILLEEXEMPLE'), 'prenomexemple.familleexemple');
  assert.equal(deriveOwnCloudUsername('FAMILLEEXEMPLE.PRENOMEXEMPLE'), 'familleexemple.prenomexemple');
  assert.equal(deriveOwnCloudUsername('  __Prénomexemple..Familleexemple__  '), 'prenomexemple.familleexemple');
});

test('deriveOwnCloudUsername keeps ambiguous title-case and lowercase names in source order', () => {
  assert.equal(deriveOwnCloudUsername('Familleexemple_Prénomexemple'), 'familleexemple.prenomexemple');
  assert.equal(deriveOwnCloudUsername('Prénomexemple_Familleexemple'), 'prenomexemple.familleexemple');
  assert.equal(deriveOwnCloudUsername('familleexemple_prenomexemple'), 'familleexemple.prenomexemple');
  assert.equal(deriveOwnCloudUsername('Prénomtest_De_La_Familleexemple'), 'prenomtest.de.la.familleexemple');
});

test('deriveOwnCloudUsername does not infer a family name from mixed-case initials or numbers', () => {
  assert.equal(deriveOwnCloudUsername('P_Familleexemple'), 'p.familleexemple');
  assert.equal(deriveOwnCloudUsername('7_Prénomexemple'), '7.prenomexemple');
});

test('deriveOwnCloudUsername handles a single name and empty separators', () => {
  assert.equal(deriveOwnCloudUsername('Prénom-Composé'), 'prenomcompose');
  assert.equal(deriveOwnCloudUsername(''), '');
  assert.equal(deriveOwnCloudUsername('___ - .'), '');
});

test('SharingFolderScanner infers usernames from generated recipient directories without changing their paths', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cac-sharing-generated-names-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const expectedUsernames = new Map([
    ['FAMILLEEXEMPLE Prénomexemple', 'prenomexemple.familleexemple'],
    ['FAMILLE-TEST Prénom-Composé', 'prenomcompose.familletest'],
    ['Prénomtest FAMILLEFICTIVE', 'prenomtest.famillefictive'],
    ['DE LA FAMILLEEXEMPLE Prénomtest', 'prenomtest.delafamilleexemple'],
    ['D’EXEMPLE Prénomtest', 'prenomtest.dexemple'],
    ['Familleexemple Prénomtest', 'familleexemple.prenomtest'],
    ['prenomtest.familleexemple', 'prenomtest.familleexemple'],
    ['FAMILLEMAJEXEMPLE PRENOMMAJEXEMPLE', 'prenommajexemple.famillemajexemple'],
    ['FAMILLEMAJ-TEST PRÉNOMMAJ-COMPOSÉ', 'prenommajcompose.famillemajtest'],
    ['DE LA FAMILLEMAJEXEMPLE PRENOMMAJTEST', 'prenommajtest.delafamillemajexemple'],
    ['PRENOMMAJEXEMPLE.FAMILLEMAJEXEMPLE', 'prenommajexemple.famillemajexemple'],
  ].map(([name, username]) => [NameSanitizer.sanitize(name, 'reviewer'), username]));
  await Promise.all([...expectedUsernames.keys()].map((name) => mkdir(path.join(root, name))));

  const recipients = await new SharingFolderScanner().scan(root);

  assert.equal(recipients.length, expectedUsernames.size);
  for (const recipient of recipients) {
    assert.equal(recipient.suggestedUsername, expectedUsernames.get(recipient.name));
    assert.equal(recipient.relativePath, recipient.name);
    assert.equal(recipient.absolutePath, path.join(root, recipient.name));
  }
});
