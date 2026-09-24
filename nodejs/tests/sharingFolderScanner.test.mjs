import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deriveOwnCloudUsername, SharingFolderScanner } from '../dist/services/sharing/sharingFolderScanner.js';
import { NameSanitizer } from '../dist/support/text/nameSanitizer.js';

test('SharingFolderScanner returns only recipient directories in locale order', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cac-sharing-scan-'));
  try {
    await Promise.all([
      mkdir(path.join(root, 'Zola Zoé')),
      mkdir(path.join(root, 'Dupont Jean')),
      mkdir(path.join(root, '.cache')),
      mkdir(path.join(root, 'node_modules')),
      writeFile(path.join(root, 'README.txt'), 'ignored'),
    ]);

    const recipients = await new SharingFolderScanner().scan(root);

    assert.deepEqual(recipients.map((recipient) => recipient.name), ['Dupont Jean', 'Zola Zoé']);
    assert.equal(recipients[0].absolutePath, path.join(root, 'Dupont Jean'));
    assert.equal(recipients[0].suggestedUsername, 'dupont.jean');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('deriveOwnCloudUsername keeps the source name order and removes accents, apostrophes and hyphens', () => {
  assert.equal(deriveOwnCloudUsername('Lafifi_Sohaib'), 'lafifi.sohaib');
  assert.equal(deriveOwnCloudUsername('O’Neil Anne-Marie'), 'oneil.annemarie');
  assert.equal(deriveOwnCloudUsername("Anne-Marie O'Neil"), 'annemarie.oneil');
  assert.equal(deriveOwnCloudUsername('Dufour Élodie'), 'dufour.elodie');
  assert.equal(deriveOwnCloudUsername('Élodie_Dufour'), 'elodie.dufour');
  assert.equal(deriveOwnCloudUsername('Jean-Pierre_Dupont'), 'jeanpierre.dupont');
  assert.equal(deriveOwnCloudUsername('Marie_De_La_Fontaine'), 'marie.de.la.fontaine');
});

test('deriveOwnCloudUsername handles existing identifiers and empty separators', () => {
  assert.equal(deriveOwnCloudUsername('pierre.marquis'), 'pierre.marquis');
  assert.equal(deriveOwnCloudUsername('  __Élodie..Dufour__  '), 'elodie.dufour');
  assert.equal(deriveOwnCloudUsername('Jean-Pierre'), 'jeanpierre');
  assert.equal(deriveOwnCloudUsername(''), '');
  assert.equal(deriveOwnCloudUsername('___ - .'), '');
});

test('SharingFolderScanner suggests usernames in the order used by generated recipient directories', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cac-sharing-generated-names-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const expectedUsernames = new Map([
    ['Pierre Marquis', 'pierre.marquis'],
    ['Marquis Pierre', 'marquis.pierre'],
    ['Jean-Pierre Dupont', 'jeanpierre.dupont'],
    ['Élodie Dufour', 'elodie.dufour'],
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
