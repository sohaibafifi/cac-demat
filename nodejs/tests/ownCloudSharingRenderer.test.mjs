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
];
const handlerSource = handlerNames.map((name) => {
  const declaration = rendererAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `Renderer handler ${name} exists`);
  return declaration.getText(rendererAst);
}).join('\n');
const handlerScript = new vm.Script(ts.transpileModule(handlerSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText, { filename: 'ownCloudSharingRenderer.js' });

function createSharingHarness({ checked, available }) {
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
  const elements = {
    ocShareAll: {},
    ocCancel: {},
    ocPickFolder: {},
    ocConnect: {},
    ocNotifyEmail: { checked },
    ocNotifyEmailControl: {
      dataset: {},
      removeAttribute(name) { delete this[name]; },
    },
    ocPermissions: { value: '1' },
    ocRecipientsList: {
      querySelectorAll: (selector) => selector === '[data-recipient]'
        ? rows
        : rows.map((row) => row.querySelector('[data-role="share"]')),
    },
  };
  const calls = [];
  const context = vm.createContext({
    elements,
    sharingRecipients: recipients,
    sharingOperationActive: false,
    sharingConnectionReady: true,
    sharingAuthenticationBlocked: false,
    sharingBatchCancelled: false,
    sharingMailNotificationAvailable: available,
    prepareSharingUploadProgress() {},
    updateSharingUploadProgress() {},
    setSharingRecipientState(row, state) { row.state = state; },
    setSharingSummary() {},
    window: {
      electronAPI: {
        async ownCloudShareFolder(payload) {
          calls.push({
            payload,
            operationActive: context.sharingOperationActive,
            notificationDisabled: elements.ocNotifyEmail.disabled,
            shareAllDisabled: elements.ocShareAll.disabled,
            rowButtonsDisabled: rows.every((row) => row.querySelector('[data-role="share"]').disabled),
          });
          return { share: { shareWith: payload.shareWith } };
        },
      },
    },
  });
  handlerScript.runInContext(context);
  context.updateSharingActionStates();
  return { context, elements, rows, recipients, calls };
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
      assert.ok(rows.every((row) => !row.querySelector('[data-role="share"]').disabled));
    });
  }
}
