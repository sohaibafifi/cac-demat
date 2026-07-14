import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { OwnCloudShareService } from '../dist/services/sharing/ownCloudShareService.js';

const credentials = {
  baseUrl: 'https://owncloud.univ-artois.fr',
  login: 'test.user',
  appPassword: 'app-password',
};

const ocsResponse = (data, statuscode = 100) => new Response(JSON.stringify({
  ocs: {
    meta: {
      status: 'ok',
      statuscode,
      message: null,
    },
    data,
  },
}), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

test('testConnection validates status, OCS identity, capabilities and WebDAV', async () => {
  const calls = [];
  const fetchMock = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/status.php')) {
      return new Response(JSON.stringify({
        installed: true,
        maintenance: false,
        versionstring: '10.6.0',
        productname: 'ownCloud',
      }), { status: 200 });
    }
    if (url.includes('/cloud/user')) {
      return ocsResponse({ id: 'test.user', 'display-name': 'Test User' }, 200);
    }
    if (url.includes('/cloud/capabilities')) {
      return ocsResponse({ capabilities: { files_sharing: { api_enabled: true, user: { send_mail: true } } } }, 100);
    }
    if (init.method === 'PROPFIND') {
      return new Response('', { status: 207 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await new OwnCloudShareService(fetchMock).testConnection(credentials);

  assert.deepEqual(result, {
    user: 'test.user',
    displayName: 'Test User',
    serverVersion: '10.6.0',
    productName: 'ownCloud',
    sharingApiEnabled: true,
    mailNotificationAvailable: true,
    webdavAvailable: true,
  });
  const authenticated = calls.filter((call) => !call.url.endsWith('/status.php'));
  assert.ok(authenticated.every((call) => call.init.headers.Authorization.startsWith('Basic ')));
  assert.ok(authenticated.every((call) => !('requesttoken' in call.init.headers)));
});

test('createShare checks existing shares before creating a user share', async () => {
  const calls = [];
  const fetchMock = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    if (init.method === 'GET') {
      return ocsResponse([]);
    }
    if (init.method === 'POST') {
      return ocsResponse({
        id: '42',
        share_type: 0,
        share_with: 'recipient.user',
        permissions: 15,
        path: '/CAC/Recipient',
        item_source: 1234,
        item_type: 'folder',
        mail_send: 0,
      });
    }
    throw new Error(`Unexpected method: ${init.method}`);
  };

  const result = await new OwnCloudShareService(fetchMock).createShare({
    ...credentials,
    remotePath: '/CAC/Recipient',
    shareWith: 'recipient.user',
    shareType: 'user',
    permissions: 15,
  });

  assert.equal(result.alreadyExisted, false);
  assert.equal(result.share.id, '42');
  assert.equal(result.share.itemSource, '1234');
  assert.equal(result.share.itemType, 'folder');
  assert.equal(calls.length, 2);
  assert.match(calls[1].init.body, /shareType=0/);
  assert.match(calls[1].init.body, /permissions=15/);
});

test('sendShareNotification posts the internal share identifiers', async () => {
  const calls = [];
  const fetchMock = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    return ocsResponse({ status: 'success' }, 200);
  };

  await new OwnCloudShareService(fetchMock).sendShareNotification(credentials, {
    id: '42',
    shareWith: 'recipient.user',
    shareType: 'user',
    permissions: 1,
    url: null,
    path: '/CAC/Recipient',
    itemSource: '1234',
    itemType: 'folder',
    mailSent: false,
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /notification\/send/);
  assert.match(calls[0].init.body, /itemSource=1234/);
  assert.match(calls[0].init.body, /itemType=folder/);
  assert.match(calls[0].init.body, /shareType=0/);
  assert.match(calls[0].init.body, /recipient=recipient.user/);
});

test('sendShareNotification rejects a failed mail status', async () => {
  const fetchMock = async () => ocsResponse({ status: 'error' }, 200);
  const service = new OwnCloudShareService(fetchMock);

  await assert.rejects(() => service.sendShareNotification(credentials, {
    id: '42',
    shareWith: 'recipient.user',
    shareType: 'user',
    permissions: 1,
    url: null,
    path: '/CAC/Recipient',
    itemSource: '1234',
    itemType: 'folder',
    mailSent: false,
  }), /notification par e-mail/);
});

test('uploadDirectory creates remote folders and streams every file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cac-owncloud-upload-'));
  try {
    await mkdir(path.join(root, 'documents'));
    await writeFile(path.join(root, 'root.txt'), 'root');
    await writeFile(path.join(root, 'documents', 'report.pdf'), 'pdf');
    const methods = [];
    const progress = [];
    const fetchMock = async (_input, init = {}) => {
      methods.push(init.method);
      if (init.method === 'PUT') {
        init.body?.destroy?.();
        return new Response('', { status: 201 });
      }
      return new Response('', { status: 201 });
    };

    const result = await new OwnCloudShareService(fetchMock).uploadDirectory(
      credentials,
      root,
      '/CAC/Recipient',
      (value) => progress.push(value.relative),
    );

    assert.deepEqual(result, { uploaded: 2, total: 2 });
    assert.equal(methods.filter((method) => method === 'PUT').length, 2);
    assert.deepEqual(progress, ['documents/report.pdf', 'root.txt']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
