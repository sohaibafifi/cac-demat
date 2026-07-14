import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { OwnCloudConfigStore } from '../dist/services/sharing/ownCloudConfigStore.js';

const config = {
  baseUrl: 'https://owncloud.univ-artois.fr/',
  login: 'test.user',
  appPassword: 'secret-app-password',
  remoteRootPath: '/CAC/Rapporteurs',
  defaultPermissions: 15,
  uploadByDefault: true,
  notifyByEmail: true,
};

const encryptedStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
  decryptString: (value) => value.toString('utf8').replace(/^encrypted:/, ''),
};

const unavailableStorage = {
  isEncryptionAvailable: () => false,
  encryptString: () => {
    throw new Error('unavailable');
  },
  decryptString: () => {
    throw new Error('unavailable');
  },
};

test('OwnCloudConfigStore persists the app password encrypted', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cac-owncloud-config-'));
  try {
    const store = new OwnCloudConfigStore(encryptedStorage, root);
    await store.save(config);

    const raw = await readFile(path.join(root, 'owncloud-config.json'), 'utf8');
    assert.equal(raw.includes(config.appPassword), false);
    assert.equal((await store.describe()).passwordStorage, 'encrypted');

    const reloaded = await new OwnCloudConfigStore(encryptedStorage, root).load();
    assert.equal(reloaded.appPassword, config.appPassword);
    assert.equal(reloaded.baseUrl, 'https://owncloud.univ-artois.fr');
    assert.equal(reloaded.notifyByEmail, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('OwnCloudConfigStore keeps the password in memory when encryption is unavailable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cac-owncloud-config-'));
  try {
    const store = new OwnCloudConfigStore(unavailableStorage, root);
    await store.save(config);

    const raw = await readFile(path.join(root, 'owncloud-config.json'), 'utf8');
    assert.equal(raw.includes(config.appPassword), false);
    assert.equal((await store.describe()).passwordStorage, 'session-only');
    assert.equal((await new OwnCloudConfigStore(unavailableStorage, root).describe()).hasPassword, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('OwnCloudConfigStore rejects a non-HTTPS server URL', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cac-owncloud-config-'));
  try {
    const store = new OwnCloudConfigStore(encryptedStorage, root);
    await assert.rejects(() => store.save({ ...config, baseUrl: 'http://owncloud.example.test' }), /HTTPS/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
