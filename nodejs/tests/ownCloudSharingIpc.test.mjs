import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {
  OwnCloudAuthenticationError,
  OwnCloudShareService,
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

function createHarness({ mailSent = 1, notificationResponse = () => response({ status: 'success' }) } = {}) {
  const calls = [];
  const share = {
    id: '42', share_type: 0, share_with: 'recipient.user', permissions: 1,
    path: '/CAC/Recipient', item_source: 1234, item_type: 'folder', mail_send: mailSent,
  };
  const service = new OwnCloudShareService(async (input, init = {}) => {
    const url = new URL(input);
    calls.push({ url, init });
    if (init.method === 'GET' && url.pathname.endsWith('/shares')) {
      return response([share]);
    }
    if (init.method === 'POST' && url.pathname.endsWith('/notification/send')) {
      return notificationResponse();
    }
    throw new Error(`Unexpected request: ${init.method} ${url.pathname}`);
  });
  const handlers = new Map();
  const SharingHandlers = script.runInNewContext({ AbortController, OwnCloudAuthenticationError, Error });
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
    share: (sendNotification) => handlers.get('owncloud:share-folder')({}, {
      recipientName: 'Recipient', remotePath: '/CAC/Recipient', localPath: '/unused',
      shareWith: 'recipient.user', shareType: 'user', mode: 'share-only', sendNotification,
    }),
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
