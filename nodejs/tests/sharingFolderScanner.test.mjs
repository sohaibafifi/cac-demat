import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deriveOwnCloudUsername, SharingFolderScanner } from '../dist/services/sharing/sharingFolderScanner.js';

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
    assert.equal(recipients[0].suggestedUsername, 'jean.dupont');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('deriveOwnCloudUsername normalizes generated folder names', () => {
  assert.equal(deriveOwnCloudUsername('Lafifi_Sohaib'), 'sohaib.lafifi');
  assert.equal(deriveOwnCloudUsername('O’Neil Anne-Marie'), 'anne-marie.oneil');
  assert.equal(deriveOwnCloudUsername('Dufour Élodie'), 'elodie.dufour');
});
