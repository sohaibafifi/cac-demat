import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Run the real sharing handlers without bootstrapping the unrelated dashboard UI.
const rendererSource = await readFile(new URL('../src/renderer/app.ts', import.meta.url), 'utf8');
const rendererAst = ts.createSourceFile('app.ts', rendererSource, ts.ScriptTarget.Latest, true);
const handlerNames = [
  'updateSharingActionStates',
  'setSharingOperationActive',
  'shareSingleRecipient',
  'handleSharingSingle',
  'handleSharingShareAll',
  'initSharingPanel',
  'handleSharingReset',
  'handleSharingConnect',
  'handleSharingPickFolder',
  'setOwnCloudMailNotificationAvailability',
  'setOwnCloudConnectionStatus',
  'renderOwnCloudPasswordState',
  'renderSharingRecipients',
  'formatError',
];
const handlerSource = handlerNames.map((name) => {
  const declaration = rendererAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `Renderer handler ${name} exists`);
  return declaration.getText(rendererAst);
}).join('\n');
const handlerScript = new vm.Script(ts.transpileModule(handlerSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText, { filename: 'ownCloudSharingRenderer.js' });

const savedConfig = {
  baseUrl: 'https://cloud.example.test',
  login: 'saved.user',
  remoteRootPath: '/SavedCAC',
  defaultPermissions: 1,
  uploadByDefault: true,
  notifyByEmail: true,
  hasPassword: true,
  passwordStorage: 'encrypted',
};

function createSharingHarness({ checked = true, available = true, notification } = {}) {
  const recipients = ['Alice', 'Bob'].map((name) => ({ name, absolutePath: `/packages/${name}` }));
  const rows = recipients.map((recipient) => {
    const controls = {
      '[data-role="share-with"]': { value: recipient.name.toLowerCase() },
      '[data-role="remote-path"]': { value: `/CAC/${recipient.name}` },
      '[data-role="mode"]': { value: 'share-only' },
      '[data-role="share"]': { disabled: false },
    };
    return {
      dataset: { recipient: recipient.name },
      querySelector: (selector) => controls[selector],
    };
  });
  const connectionText = {};
  const elements = {
    ocShareAll: {},
    ocCancel: {},
    ocPickFolder: {},
    ocConnect: {},
    ocReset: {},
    ocBaseUrl: { value: 'https://unsaved.example.test' },
    ocLogin: { value: 'unsaved.user' },
    ocRemoteRoot: { value: '/UnsavedCAC' },
    ocPassword: { value: 'unsaved-password' },
    ocUploadDefault: { checked: false },
    ocSecurityNote: {},
    ocTestResult: { dataset: {}, querySelector: () => connectionText },
    ocFolderPath: { textContent: '/packages', dataset: { empty: 'false' } },
    ocRecipientCount: { textContent: '2 destinataires' },
    ocNotifyEmail: { checked },
    ocNotifyEmailControl: {
      dataset: {},
      removeAttribute(name) { delete this[name]; },
    },
    ocPermissions: { value: '1' },
    ocRecipientsList: {
      children: [],
      set innerHTML(value) { rows.length = 0; this.children = []; },
      appendChild(child) { this.children.push(child); },
      querySelectorAll: (selector) => selector === '[data-recipient]'
        ? rows
        : rows.map((row) => row.querySelector('[data-role="share"]')),
    },
  };
  const calls = [];
  const apiCalls = [];
  const recordUnexpectedCall = (name) => () => {
    apiCalls.push(name);
    throw new Error(`Unexpected API call: ${name}`);
  };
  const context = vm.createContext({
    Error,
    elements,
    document: { createElement: () => ({}) },
    sharingFolder: '/packages',
    sharingPanelLoaded: false,
    sharingRecipients: recipients,
    sharingOperationActive: false,
    sharingPanelBusy: false,
    sharingConnectionReady: true,
    sharingAuthenticationBlocked: false,
    sharingBatchCancelled: false,
    sharingMailNotificationAvailable: available,
    prepareSharingUploadProgress() {},
    updateSharingUploadProgress() {},
    setSharingRecipientState(row, state, statusText, resultText) { Object.assign(row, { state, statusText, resultText }); },
    setSharingSummary() {},
    window: {
      electronAPI: {
        async ownCloudGetConfig() { apiCalls.push('ownCloudGetConfig'); return { ...savedConfig }; },
        ownCloudSetConfig: recordUnexpectedCall('ownCloudSetConfig'),
        ownCloudTest: recordUnexpectedCall('ownCloudTest'),
        selectFolder: recordUnexpectedCall('selectFolder'),
        ownCloudScanFolder: recordUnexpectedCall('ownCloudScanFolder'),
        async ownCloudShareFolder(payload) {
          calls.push({
            payload,
            operationActive: context.sharingOperationActive,
            notificationDisabled: elements.ocNotifyEmail.disabled,
            shareAllDisabled: elements.ocShareAll.disabled,
            resetDisabled: elements.ocReset.disabled,
            rowButtonsDisabled: rows.every((row) => row.querySelector('[data-role="share"]').disabled),
          });
          return { share: { shareWith: payload.shareWith }, notification };
        },
      },
    },
  });
  handlerScript.runInContext(context);
  context.updateSharingActionStates();
  return { context, elements, rows, recipients, calls, apiCalls, connectionText };
}

const notificationCases = [
  { label: 'checked and supported', checked: true, available: true, expected: true },
  { label: 'unchecked', checked: false, available: true, expected: false },
  { label: 'unsupported', checked: true, available: false, expected: false },
  { label: 'capability unknown', checked: true, available: null, expected: false },
];

for (const operation of ['single', 'batch']) {
  for (const notification of notificationCases) {
    test(`${operation} sharing preserves notification intent when ${notification.label}`, async () => {
      const { context, elements, rows, recipients, calls } = createSharingHarness(notification);
      if (operation === 'single') {
        await context.handleSharingSingle(rows[0], recipients[0]);
      } else {
        await context.handleSharingShareAll();
      }

      const expectedRecipients = operation === 'single' ? recipients.slice(0, 1) : recipients;
      assert.equal(calls.length, expectedRecipients.length);
      for (const [index, call] of calls.entries()) {
        assert.equal(call.payload.recipientName, expectedRecipients[index].name);
        assert.equal(call.operationActive, true);
        assert.equal(call.notificationDisabled, true, 'Checkbox is temporarily disabled during the request');
        assert.equal(call.shareAllDisabled, true);
        assert.equal(call.resetDisabled, true);
        assert.equal(call.rowButtonsDisabled, true);
        assert.equal(call.payload.sendNotification, notification.expected);
        assert.equal(rows[index].state, 'success');
      }

      assert.equal(context.sharingOperationActive, false);
      assert.equal(elements.ocNotifyEmail.checked, notification.checked);
      assert.equal(elements.ocNotifyEmail.disabled, notification.available !== true);
      assert.equal(elements.ocNotifyEmailControl.dataset.disabled, String(notification.available !== true));
      assert.equal(elements.ocShareAll.disabled, false);
      assert.equal(elements.ocCancel.disabled, true);
      assert.equal(elements.ocPickFolder.disabled, false);
      assert.equal(elements.ocConnect.disabled, false);
      assert.equal(elements.ocReset.disabled, false);
      assert.ok(rows.every((row) => !row.querySelector('[data-role="share"]').disabled));
    });
  }
}

test('reset clears transient state and reloads saved configuration without writing or connecting', async () => {
  const { context, elements, rows, recipients, calls, apiCalls } = createSharingHarness();
  context.sharingPanelLoaded = true;
  context.sharingAuthenticationBlocked = true;
  context.sharingBatchCancelled = true;
  elements.ocPermissions.value = '31';
  elements.ocNotifyEmail.checked = false;
  let resolveConfig;
  const pendingConfig = new Promise((resolve) => { resolveConfig = resolve; });
  context.window.electronAPI.ownCloudGetConfig = () => {
    apiCalls.push('ownCloudGetConfig');
    return pendingConfig;
  };
  const formerRow = rows[0];
  const formerRecipient = recipients[0];
  const reset = context.handleSharingReset();

  assert.equal(context.sharingFolder, null);
  assert.equal(context.sharingRecipients.length, 0);
  assert.equal(context.sharingBatchCancelled, false);
  assert.equal(context.sharingAuthenticationBlocked, false);
  assert.equal(context.sharingConnectionReady, false);
  assert.equal(context.sharingMailNotificationAvailable, null);
  assert.equal(context.sharingPanelLoaded, false);
  assert.equal(context.sharingPanelBusy, true);
  assert.equal(elements.ocPassword.value, '');
  assert.equal(elements.ocFolderPath.dataset.empty, 'true');
  assert.equal(elements.ocRecipientCount.textContent, '0 destinataire');
  assert.equal(rows.length, 0);
  assert.match(elements.ocRecipientsList.children[0].textContent, /Choisissez un dossier/);
  for (const name of ['ocReset', 'ocConnect', 'ocPickFolder', 'ocShareAll', 'ocNotifyEmail']) {
    assert.equal(elements[name].disabled, true, `${name} disabled during configuration load`);
  }
  await context.handleSharingReset();
  await context.handleSharingConnect();
  await context.handleSharingPickFolder();
  await context.handleSharingSingle(formerRow, formerRecipient);
  await context.handleSharingShareAll();
  assert.deepEqual(apiCalls, ['ownCloudGetConfig']);
  assert.equal(calls.length, 0);

  resolveConfig({ ...savedConfig });
  await reset;
  assert.equal(elements.ocBaseUrl.value, savedConfig.baseUrl);
  assert.equal(elements.ocLogin.value, savedConfig.login);
  assert.equal(elements.ocRemoteRoot.value, savedConfig.remoteRootPath);
  assert.equal(elements.ocPermissions.value, String(savedConfig.defaultPermissions));
  assert.equal(elements.ocUploadDefault.checked, savedConfig.uploadByDefault);
  assert.equal(elements.ocNotifyEmail.checked, savedConfig.notifyByEmail);
  assert.equal(elements.ocPassword.value, '');
  assert.equal(elements.ocPassword.placeholder, 'Mot de passe déjà renseigné');
  assert.equal(context.sharingPanelLoaded, true);
  assert.equal(context.sharingPanelBusy, false);
  assert.equal(elements.ocReset.disabled, false);
  assert.equal(elements.ocConnect.disabled, false);
  assert.equal(elements.ocPickFolder.disabled, false);
  assert.equal(elements.ocShareAll.disabled, true, 'A new successful connection is required');
  assert.equal(elements.ocNotifyEmail.disabled, true, 'Server capabilities must be checked again');
  await context.initSharingPanel();
  assert.deepEqual(apiCalls, ['ownCloudGetConfig'], 'Loaded configuration is cached until the next reset');
});

test('reset and other panel actions cannot interrupt an active share', async () => {
  const { context, elements, recipients, apiCalls } = createSharingHarness();
  context.setSharingOperationActive(true);
  assert.equal(elements.ocReset.disabled, true);
  await context.handleSharingReset();
  await context.handleSharingConnect();
  await context.handleSharingPickFolder();
  assert.deepEqual(apiCalls, []);
  assert.equal(context.sharingFolder, '/packages');
  assert.equal(context.sharingRecipients, recipients);
  assert.equal(elements.ocPassword.value, 'unsaved-password');
  assert.equal(context.sharingConnectionReady, true);
  context.setSharingOperationActive(false);
  assert.equal(elements.ocReset.disabled, false);
});

test('failed configuration loads leave the panel available for retry', async () => {
  const { context, elements, connectionText } = createSharingHarness();
  let attempts = 0;
  context.window.electronAPI.ownCloudGetConfig = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('configuration unavailable');
    return { ...savedConfig };
  };
  await context.initSharingPanel();
  assert.equal(context.sharingPanelLoaded, false);
  assert.equal(context.sharingPanelBusy, false);
  assert.equal(elements.ocReset.disabled, false);
  assert.equal(elements.ocTestResult.dataset.state, 'error');
  assert.match(connectionText.textContent, /configuration unavailable/);
  await context.initSharingPanel();
  assert.equal(attempts, 2);
  assert.equal(context.sharingPanelLoaded, true);
  assert.equal(context.sharingPanelBusy, false);
  assert.equal(elements.ocTestResult.dataset.state, 'idle');
  assert.equal(elements.ocLogin.value, savedConfig.login);
});

test('a successful mail request is reported as accepted by ownCloud', async () => {
  const { context, rows, recipients } = createSharingHarness({ notification: { requested: true, sent: true } });
  await context.handleSharingSingle(rows[0], recipients[0]);
  assert.match(rows[0].resultText, /Demande de notification acceptée par ownCloud\./);
  assert.doesNotMatch(rows[0].resultText, /e-mail envoyée/);
});

test('legacy alreadySent metadata does not claim a notification was delivered', async () => {
  const { context, rows, recipients } = createSharingHarness({ notification: { alreadySent: true, sent: false } });
  await context.handleSharingSingle(rows[0], recipients[0]);
  assert.equal(rows[0].state, 'success');
  assert.doesNotMatch(rows[0].resultText, /notification|envoyée/i);
});
