import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../src/renderer/app.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('app.ts', source, ts.ScriptTarget.Latest, true);
const functions = ['handleMemberImport', 'updateCoordinator', 'showMemberImportSummary'].map((name) => {
  const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, name);
  return declaration.getText(ast);
});
const bindings = [];
function collectBindings(node) {
  if (ts.isCallExpression(node) && ['elements.loadMembersCsv.addEventListener', 'elements.appendMembersCsv.addEventListener'].includes(node.expression.getText(ast))) {
    bindings.push(node.getText(ast));
  }
  ts.forEachChild(node, collectBindings);
}
collectBindings(ast);
assert.equal(bindings.length, 2);
const script = new vm.Script(ts.transpileModule([...functions, ...bindings].join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText);

function harness({ selected = '/pr.csv', failure = null, running = false } = {}) {
  const calls = [];
  const alerts = [];
  const dialogs = [];
  const listeners = {};
  const oldState = { running, csvMembers: ['/mcf.csv'], membersFromCsv: [{ name: 'Membre MCF', files: [] }], membersManual: [] };
  const api = {
    selectCsv: async () => selected,
    setMembersCsv: async (file, mode) => {
      calls.push({ file, mode });
      if (failure) throw new Error(failure);
      return { running: false, csvMembers: [file], membersFromCsv: [{ name: 'Membre PR', files: ['PR.pdf'] }], membersManual: [] };
    },
    showMessageBox: async (options) => dialogs.push(options),
  };
  const context = vm.createContext({
    currentState: oldState,
    busy: false,
    console: { error() {} },
    getElectronApiOrWarn: async () => api,
    resolveElectronApi: async () => api,
    alert: (message) => alerts.push(message),
    formatError: (error) => error.message,
    setBusy(value) { context.busy = value; },
    setState(value) { context.currentState = value; },
    elements: {
      loadMembersCsv: { addEventListener: (_type, listener) => { listeners.replace = listener; } },
      appendMembersCsv: { addEventListener: (_type, listener) => { listeners.append = listener; } },
    },
  });
  script.runInContext(context);
  return { context, calls, alerts, dialogs, listeners, oldState };
}

for (const mode of ['replace', 'append']) {
  test(`${mode} member import button passes its explicit mode and shows the active list`, async () => {
    const h = harness();
    await h.listeners[mode]();
    assert.deepEqual(h.calls, [{ file: '/pr.csv', mode }]);
    assert.equal(h.dialogs.length, 1);
    assert.match(h.dialogs[0].detail, /Fichiers actifs : 1/);
    assert.match(h.dialogs[0].detail, /Membre PR/);
    assert.doesNotMatch(h.dialogs[0].detail, /Membre MCF/);
    assert.equal(h.context.busy, false);
  });
}

test('failed member import shows the failure and never displays the old list as a successful import', async () => {
  const h = harness({ failure: 'Liste illisible, liste active inchangée' });
  await h.listeners.replace();
  assert.deepEqual(h.alerts, ['Liste illisible, liste active inchangée']);
  assert.equal(h.dialogs.length, 0);
  assert.equal(h.context.currentState, h.oldState);
  assert.equal(h.context.busy, false);
});

test('cancelling a new member list keeps the active list', async () => {
  const h = harness({ selected: null });
  await h.listeners.replace();
  assert.equal(h.calls.length, 0);
  assert.equal(h.dialogs.length, 0);
  assert.equal(h.context.currentState, h.oldState);
  assert.equal(h.context.busy, false);
});

test('member import does not start while the pipeline runs', async () => {
  const h = harness({ running: true });
  await h.listeners.replace();
  await h.listeners.append();
  assert.equal(h.calls.length, 0);
});
