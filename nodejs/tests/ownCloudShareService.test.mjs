import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  OwnCloudAuthenticationError,
  OwnCloudShareService,
  validateOwnCloudExpireDate,
} from '../dist/services/sharing/ownCloudShareService.js';

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

test('testConnection stops after the first rejected authentication', async () => {
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
    return new Response('Unauthorized', { status: 401 });
  };

  await assert.rejects(
    () => new OwnCloudShareService(fetchMock).testConnection(credentials),
    OwnCloudAuthenticationError,
  );

  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /\/cloud\/user/);
  assert.ok(!calls.some((call) => call.url.includes('/cloud/capabilities')));
  assert.ok(!calls.some((call) => call.init.method === 'PROPFIND'));
});

test('testConnection treats a forbidden identity response as an authentication rejection', async () => {
  const fetchMock = async (input) => {
    if (String(input).endsWith('/status.php')) {
      return new Response(JSON.stringify({
        installed: true,
        maintenance: false,
        versionstring: '10.6.0',
        productname: 'ownCloud',
      }), { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  };

  await assert.rejects(
    () => new OwnCloudShareService(fetchMock).testConnection(credentials),
    OwnCloudAuthenticationError,
  );
});

test('uploadDirectory reports a rejected WebDAV authentication', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cac-owncloud-auth-'));
  try {
    const fetchMock = async () => new Response('Unauthorized', { status: 401 });
    await assert.rejects(
      () => new OwnCloudShareService(fetchMock).uploadDirectory(credentials, root, '/CAC/Recipient'),
      OwnCloudAuthenticationError,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
  assert.equal(result.share.expiration, null);
  assert.equal(calls.length, 2);
  assert.match(calls[1].init.body, /shareType=0/);
  assert.match(calls[1].init.body, /permissions=15/);
  assert.equal(new URLSearchParams(calls[1].init.body).has('expireDate'), false);
});

test('expiration validation accepts calendar dates from today and rejects invalid or past dates', () => {
  const now = new Date(2028, 1, 29, 12);
  assert.equal(validateOwnCloudExpireDate(undefined, now), undefined);
  assert.equal(validateOwnCloudExpireDate('', now), undefined);
  assert.equal(validateOwnCloudExpireDate('2028-02-29', now), '2028-02-29');
  assert.equal(validateOwnCloudExpireDate('2029-01-01', now), '2029-01-01');
  for (const invalid of ['2028-02-28', '2029-02-29', '2028-02-30', '2028-13-01', '2028-2-29', '29/02/2028', '2028-02-29T12:00:00Z', null, 20280229]) {
    assert.throws(() => validateOwnCloudExpireDate(invalid, now), /expiration ownCloud/);
  }
});

const expiringShare = {
  id: '42', share_type: 0, share_with: 'recipient.user', permissions: 15,
  path: '/CAC/Recipient', item_source: 1234, item_type: 'folder', mail_send: 0,
  expiration: '9999-05-31 00:00:00',
};
const expiringShareInput = {
  ...credentials, remotePath: '/CAC/Recipient', shareWith: 'recipient.user', shareType: 'user',
  expireDate: '9999-05-31',
};

test('creating a share sends the requested expiration and returns the confirmed server value', async () => {
  const calls = [];
  const service = new OwnCloudShareService(async (url, init) => {
    calls.push({ url: String(url), init });
    return ocsResponse(init.method === 'GET' ? [] : expiringShare);
  });
  const result = await service.createShare(expiringShareInput);
  assert.equal(result.alreadyExisted, false);
  assert.equal(result.share.expiration, expiringShare.expiration);
  assert.deepEqual(calls.map(({ init }) => init.method), ['GET', 'POST']);
  assert.equal(new URLSearchParams(calls[1].init.body).get('expireDate'), '9999-05-31');
});

test('an existing share receives only an expiration update and retains its permissions', async () => {
  const calls = [];
  const service = new OwnCloudShareService(async (url, init) => {
    calls.push({ url: String(url), init });
    return ocsResponse(init.method === 'GET' ? [{ ...expiringShare, expiration: null }] : expiringShare);
  });
  const result = await service.createShare({ ...expiringShareInput, permissions: 1 });
  assert.equal(result.alreadyExisted, true);
  assert.equal(result.share.permissions, 15);
  assert.equal(result.share.expiration, expiringShare.expiration);
  assert.deepEqual(calls.map(({ init }) => init.method), ['GET', 'PUT']);
  assert.match(calls[1].url, /\/shares\/42\?format=json$/);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(calls[1].init.body)), { expireDate: '9999-05-31' });
});

for (const expireDate of [undefined, '', '9999-05-31']) {
  test(`an existing expiration is preserved without a redundant write for ${String(expireDate)}`, async () => {
    const calls = [];
    const service = new OwnCloudShareService(async (_url, init) => {
      calls.push(init.method);
      return ocsResponse([expiringShare]);
    });
    const result = await service.createShare({ ...expiringShareInput, expireDate });
    assert.equal(result.share.expiration, expiringShare.expiration);
    assert.deepEqual(calls, ['GET']);
  });
}

test('an invalid expiration is rejected before any service network request', async () => {
  let calls = 0;
  const service = new OwnCloudShareService(async () => { calls += 1; throw new Error('Unexpected network request'); });
  await assert.rejects(() => service.createShare({ ...expiringShareInput, expireDate: '9999-02-30' }), /expiration ownCloud/);
  assert.equal(calls, 0);
});

for (const existing of [false, true]) {
  for (const expiration of [null, '9999-06-01 00:00:00']) {
    test(`a ${existing ? 'reused' : 'new'} share cannot report success for unconfirmed expiration ${expiration}`, async () => {
      const service = new OwnCloudShareService(async (_url, init) => ocsResponse(init.method === 'GET'
        ? (existing ? [{ ...expiringShare, expiration: null }] : [])
        : { ...expiringShare, expiration }));
      await assert.rejects(() => service.createShare(expiringShareInput), /n’a pas confirmé la date d’expiration/);
    });
  }
}

test('a server expiration update failure remains visible', async () => {
  const calls = [];
  const service = new OwnCloudShareService(async (_url, init) => {
    calls.push(init.method);
    return init.method === 'GET'
      ? ocsResponse([{ ...expiringShare, expiration: null }])
      : new Response(JSON.stringify({ ocs: { meta: { status: 'failure', statuscode: 403, message: 'Expiration forbidden' }, data: [] } }), { status: 403 });
  });
  await assert.rejects(() => service.createShare(expiringShareInput), /Expiration forbidden/);
  assert.deepEqual(calls, ['GET', 'PUT']);
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

const resendInput = {
  ...credentials, remotePath: '/CAC/Recipient', shareWith: 'recipient.user', shareType: 'user',
};

for (const shareType of ['user', 'group']) {
  test(`resending a ${shareType} notification ignores mail_send and preserves the share on repeated requests`, async () => {
    const calls = [];
    const share = { ...expiringShare, share_type: shareType === 'user' ? 0 : 1, mail_send: 1 };
    const service = new OwnCloudShareService(async (url, init) => {
      calls.push({ url: new URL(url), init });
      return ocsResponse(init.method === 'GET' ? [share] : { status: 'success' });
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await service.resendShareNotification({ ...resendInput, shareType });
      assert.equal(result.id, '42');
      assert.equal(result.permissions, 15);
      assert.equal(result.expiration, expiringShare.expiration);
    }
    assert.deepEqual(calls.map(({ init }) => init.method), ['GET', 'POST', 'GET', 'POST']);
    for (const call of calls.filter(({ init }) => init.method === 'POST')) {
      assert.equal(call.url.pathname, '/ocs/v2.php/apps/files_sharing/api/v1/notification/send');
      assert.deepEqual(Object.fromEntries(new URLSearchParams(call.init.body)), {
        itemSource: '1234', itemType: 'folder', shareType: shareType === 'user' ? '0' : '1', recipient: 'recipient.user',
      });
    }
  });
}

for (const [name, shares] of [
  ['missing share', []],
  ['other recipient', [{ ...expiringShare, share_with: 'other.user' }]],
  ['other share type', [{ ...expiringShare, share_type: 1 }]],
  ['other folder', [{ ...expiringShare, path: '/CAC/AnotherRecipient' }]],
]) {
  test(`resend refuses a ${name} without any mutation`, async () => {
    const calls = [];
    const service = new OwnCloudShareService(async (_url, init) => {
      calls.push(init.method);
      return ocsResponse(shares);
    });
    await assert.rejects(() => service.resendShareNotification(resendInput), /Aucun partage existant/);
    assert.deepEqual(calls, ['GET']);
  });
}

test('resend selects the exact existing share even when other recipients or paths are returned', async () => {
  const calls = [];
  const service = new OwnCloudShareService(async (_url, init) => {
    calls.push(init);
    return ocsResponse(init.method === 'GET' ? [
      { ...expiringShare, id: '40', share_with: 'other.user', item_source: 111 },
      { ...expiringShare, id: '41', path: '/CAC/AnotherRecipient', item_source: 222 },
      expiringShare,
    ] : { status: 'success' });
  });
  const result = await service.resendShareNotification(resendInput);
  assert.equal(result.id, '42');
  assert.equal(new URLSearchParams(calls[1].body).get('itemSource'), '1234');
});

test('resend rejects unsupported types before querying ownCloud', async () => {
  let calls = 0;
  const service = new OwnCloudShareService(async () => { calls += 1; throw new Error('Unexpected request'); });
  await assert.rejects(() => service.resendShareNotification({ ...resendInput, shareType: 'email' }), /réservée aux partages/);
  assert.equal(calls, 0);
});

test('resend cancellation after lookup stops before the notification request', async () => {
  const controller = new AbortController();
  const calls = [];
  const service = new OwnCloudShareService(async (_url, init) => {
    calls.push(init.method);
    controller.abort();
    return ocsResponse([expiringShare]);
  });
  await assert.rejects(() => service.resendShareNotification(resendInput, controller.signal), /annul/);
  assert.deepEqual(calls, ['GET']);
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
