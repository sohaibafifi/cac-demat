import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {
  OwnCloudAuthenticationError,
  OwnCloudShareService,
  validateOwnCloudExpireDate,
} from '../dist/services/sharing/ownCloudShareService.js';

// Exercise the real IPC handlers and network service without starting Electron.
const source = await readFile(new URL('../src/electron/ipcHandlers.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('ipcHandlers.ts', source, ts.ScriptTarget.Latest, true);
const registry = ast.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === 'IpcHandlerRegistry');
assert.ok(registry, 'IPC registry exists');
const methodNames = ['registerSharingHandlers', 'assertCredentials', 'normalizeRemotePath'];
const methods = methodNames.map((name) => {
  const method = registry.members.find((node) => ts.isMethodDeclaration(node) && node.name.getText(ast) === name);
  assert.ok(method, `IPC method ${name} exists`);
  return method.getText(ast);
}).join('\n');
const script = new vm.Script(ts.transpileModule(`class SharingHandlers { ${methods} }\nSharingHandlers`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText);

const response = (data, message = null) => new Response(JSON.stringify({
  ocs: { meta: { status: 'ok', statuscode: 200, message }, data },
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

function createHarness({ mailSent = 1, notificationResponse = () => response({ status: 'success' }), expirationResponse, listedShares } = {}) {
  const calls = [];
  const share = {
    id: '42', share_type: 0, share_with: 'recipient.user', permissions: 1,
    path: '/CAC/Recipient', item_source: 1234, item_type: 'folder', mail_send: mailSent,
  };
  const service = new OwnCloudShareService(async (input, init = {}) => {
    const url = new URL(input);
    calls.push({ url, init });
    if (init.method === 'GET' && url.pathname.endsWith('/shares')) {
      return response(listedShares ?? [share]);
    }
    if (init.method === 'POST' && url.pathname.endsWith('/notification/send')) {
      return notificationResponse();
    }
    if (init.method === 'PUT' && url.pathname.endsWith('/shares/42')) {
      return expirationResponse ? expirationResponse() : response({ ...share, expiration: `${new URLSearchParams(init.body).get('expireDate')} 00:00:00` });
    }
    throw new Error(`Unexpected request: ${init.method} ${url.pathname}`);
  });
  const handlers = new Map();
  const SharingHandlers = script.runInNewContext({ AbortController, OwnCloudAuthenticationError, validateOwnCloudExpireDate, Error });
  const instance = new SharingHandlers();
  Object.assign(instance, {
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    ownCloudConfigStore: { load: async () => ({
      baseUrl: 'https://owncloud.example.test', login: 'sender.user', appPassword: 'test-password',
      defaultPermissions: 1,
    }) },
    ownCloudShareService: service,
    activeOwnCloudController: null,
  });
  instance.registerSharingHandlers();
  return {
    calls,
    instance,
    share: (sendNotification, overrides = {}) => handlers.get('owncloud:share-folder')({}, {
      recipientName: 'Recipient', remotePath: '/CAC/Recipient', localPath: '/unused',
      shareWith: 'recipient.user', shareType: 'user', mode: 'share-only', sendNotification,
      ...overrides,
    }),
    resend: (overrides = {}) => handlers.get('owncloud:resend-notification')({}, {
      recipientName: 'Recipient', remotePath: '/CAC/Recipient',
      shareWith: 'recipient.user', shareType: 'user', ...overrides,
    }),
    cancel: () => handlers.get('owncloud:cancel')(),
  };
}

for (const mailSent of [0, 1]) {
  test(`explicit notification reaches ownCloud for an existing share with mail_send=${mailSent}`, async () => {
    const harness = createHarness({ mailSent });
    const result = await harness.share(true);

    assert.equal(result.alreadyExisted, true);
    assert.equal(result.notification.requested, true);
    assert.equal(result.notification.sent, true);
    assert.equal(result.notification.error, null);
    assert.equal(harness.calls.length, 2);
    const request = harness.calls[1];
    assert.equal(request.url.pathname, '/ocs/v2.php/apps/files_sharing/api/v1/notification/send');
    assert.equal(request.url.searchParams.get('format'), 'json');
    assert.deepEqual(Object.fromEntries(new URLSearchParams(request.init.body)), {
      itemSource: '1234', itemType: 'folder', shareType: '0', recipient: 'recipient.user',
    });
    assert.equal(harness.instance.activeOwnCloudController, null);
  });
}

test('sharing without an explicit notification request never sends mail', async () => {
  const harness = createHarness({ mailSent: 0 });
  const result = await harness.share(false);

  assert.equal(result.notification.requested, false);
  assert.equal(result.notification.sent, false);
  assert.equal(harness.calls.length, 1);
});

test('a server mail failure is reported separately from the successful share', async () => {
  const harness = createHarness({
    mailSent: 1,
    notificationResponse: () => response({ status: 'error' }, 'Recipient has no email address'),
  });
  const result = await harness.share(true);

  assert.equal(result.share.id, '42');
  assert.equal(result.notification.sent, false);
  assert.equal(result.notification.error, 'Recipient has no email address');
  assert.equal(harness.calls.length, 2);
});

test('a notification response without confirmation is not reported as sent', async () => {
  const harness = createHarness({ mailSent: 0, notificationResponse: () => response(null) });
  const result = await harness.share(true);

  assert.equal(result.notification.sent, false);
  assert.match(result.notification.error, /confirmation/);
});

test('a rejected mail authentication propagates so the batch stops', async () => {
  const harness = createHarness({
    mailSent: 1,
    notificationResponse: () => new Response('Unauthorized', { status: 401 }),
  });

  await assert.rejects(() => harness.share(true), OwnCloudAuthenticationError);
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.instance.activeOwnCloudController, null);
});

test('IPC validates the expiration before uploading or contacting ownCloud', async () => {
  const harness = createHarness();
  let uploads = 0;
  harness.instance.ownCloudShareService.uploadDirectory = async () => { uploads += 1; };
  await assert.rejects(() => harness.share(true, { mode: 'upload-and-share', expireDate: '9999-02-30' }), /expiration ownCloud/);
  assert.equal(uploads, 0);
  assert.equal(harness.calls.length, 0);
  assert.equal(harness.instance.activeOwnCloudController, null);
});

test('IPC sets expiration on an existing share before requesting its notification', async () => {
  const harness = createHarness();
  const result = await harness.share(true, { expireDate: '9999-05-31' });
  assert.equal(result.share.expiration, '9999-05-31 00:00:00');
  assert.equal(result.notification.sent, true);
  assert.deepEqual(harness.calls.map(({ init }) => init.method), ['GET', 'PUT', 'POST']);
  assert.equal(harness.instance.activeOwnCloudController, null);
});

test('IPC does not send notification when the requested expiration is not confirmed', async () => {
  const harness = createHarness({ expirationResponse: () => response({ id: '42', expiration: null }) });
  await assert.rejects(() => harness.share(true, { expireDate: '9999-05-31' }), /n’a pas confirmé la date d’expiration/);
  assert.deepEqual(harness.calls.map(({ init }) => init.method), ['GET', 'PUT']);
  assert.equal(harness.instance.activeOwnCloudController, null);
});

test('resend IPC requests a new notification on every click without changing an existing share', async () => {
  const harness = createHarness({ mailSent: 1 });
  harness.instance.ownCloudShareService.createShare = () => assert.fail('must not create or update a share');
  harness.instance.ownCloudShareService.uploadDirectory = () => assert.fail('must not upload');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await harness.resend({ expireDate: '9999-05-31', permissions: 31, mode: 'upload-and-share', localPath: '/unused' });
    assert.equal(result.share.id, '42');
    assert.equal(result.share.permissions, 1);
    assert.equal(result.share.expiration, null);
    assert.equal(result.notification.requested, true);
    assert.equal(result.notification.sent, true);
    assert.equal(result.notification.error, null);
    assert.equal(harness.instance.activeOwnCloudController, null);
  }
  assert.deepEqual(harness.calls.map(({ url, init }) => [init.method, url.pathname]), [
    ['GET', '/ocs/v2.php/apps/files_sharing/api/v1/shares'],
    ['POST', '/ocs/v2.php/apps/files_sharing/api/v1/notification/send'],
    ['GET', '/ocs/v2.php/apps/files_sharing/api/v1/shares'],
    ['POST', '/ocs/v2.php/apps/files_sharing/api/v1/notification/send'],
  ]);
});

test('resend IPC fails for a missing share without creating one', async () => {
  const harness = createHarness({ listedShares: [] });
  await assert.rejects(() => harness.resend(), /Aucun partage existant/);
  assert.deepEqual(harness.calls.map(({ init }) => init.method), ['GET']);
  assert.equal(harness.instance.activeOwnCloudController, null);
});

for (const invalid of [
  { shareWith: '' }, { shareWith: 123 }, { shareType: 'email' }, { shareType: 'public' },
  { remotePath: '' }, { remotePath: undefined }, { remotePath: '/CAC/../Recipient' },
]) {
  test(`resend IPC rejects invalid recipient or path ${JSON.stringify(invalid)} before network activity`, async () => {
    const harness = createHarness();
    await assert.rejects(() => harness.resend(invalid));
    assert.equal(harness.calls.length, 0);
    assert.equal(harness.instance.activeOwnCloudController, null);
  });
}

for (const [name, notificationResponse, expected] of [
  ['mail rejection', () => response({ status: 'error' }, 'Recipient has no email address'), /Recipient has no email address/],
  ['unconfirmed mail', () => response(null), /confirmation/],
  ['authentication rejection', () => new Response('Unauthorized', { status: 401 }), OwnCloudAuthenticationError],
]) {
  test(`resend IPC propagates ${name} and releases its operation lock`, async () => {
    const harness = createHarness({ notificationResponse });
    await assert.rejects(() => harness.resend(), expected);
    assert.equal(harness.calls.length, 2);
    assert.equal(harness.instance.activeOwnCloudController, null);
  });
}

test('resend IPC holds its lock while loading credentials and blocks simultaneous operations', async () => {
  const harness = createHarness();
  const load = harness.instance.ownCloudConfigStore.load;
  let release;
  harness.instance.ownCloudConfigStore.load = () => new Promise((resolve) => { release = resolve; });
  const pending = harness.resend();
  assert.ok(harness.instance.activeOwnCloudController);
  await assert.rejects(() => harness.resend(), /déjà en cours/);
  await assert.rejects(() => harness.share(true), /déjà en cours/);
  release(await load());
  await pending;
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.instance.activeOwnCloudController, null);
});

test('a cancellation during credential loading prevents a resend and releases the lock', async () => {
  const harness = createHarness();
  const load = harness.instance.ownCloudConfigStore.load;
  let release;
  harness.instance.ownCloudConfigStore.load = () => new Promise((resolve) => { release = resolve; });
  const pending = harness.resend();
  assert.equal(await harness.cancel(), true);
  release(await load());
  await assert.rejects(() => pending, /annul/);
  assert.equal(harness.calls.length, 0);
  assert.equal(harness.instance.activeOwnCloudController, null);
});

test('a share that was still loading credentials cannot replace a concurrent resend lock', async () => {
  const harness = createHarness();
  const config = await harness.instance.ownCloudConfigStore.load();
  const pendingLoads = [];
  harness.instance.ownCloudConfigStore.load = () => new Promise((resolve) => { pendingLoads.push(resolve); });
  const sharing = harness.share(true);
  const resending = harness.resend();
  const resendController = harness.instance.activeOwnCloudController;
  pendingLoads[0](config);
  await assert.rejects(() => sharing, /déjà en cours/);
  assert.equal(harness.instance.activeOwnCloudController, resendController);
  pendingLoads[1](config);
  await resending;
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.instance.activeOwnCloudController, null);
});

test('a missing credential releases the resend lock without network activity', async () => {
  const harness = createHarness();
  harness.instance.ownCloudConfigStore.load = async () => ({ baseUrl: '', login: '', appPassword: '' });
  await assert.rejects(() => harness.resend(), /Configuration ownCloud incomplète/);
  assert.equal(harness.calls.length, 0);
  assert.equal(harness.instance.activeOwnCloudController, null);
});
