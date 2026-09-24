import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../src/renderer/app.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('app.ts', source, ts.ScriptTarget.Latest, true);
const functions = ['notifyCompletionIfNeeded', 'notifyRunFailure', 'buildCompletionMessage'].map((name) => {
  const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, name);
  return declaration.getText(ast);
}).join('\n');
const script = new vm.Script(ts.transpileModule(functions, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText);

function harness() {
  const dialogs = [];
  const context = vm.createContext({
    lastRunNotificationId: null,
    lastRunFailureNotification: null,
    window: {},
    resolveElectronApi: async () => ({ showMessageBox: async (options) => dialogs.push(options) }),
    console,
  });
  script.runInContext(context);
  return { context, dialogs };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('fatal generation errors show their details once per run, including repeated failed runs', async () => {
  const { context, dialogs } = harness();
  const failure = { status: 'Erreur', running: false, runErrors: ['Collision de fichiers: CV.pdf et CV.docx'], lastRunStats: null };
  context.notifyCompletionIfNeeded({ ...failure, running: true });
  assert.equal(dialogs.length, 0);
  context.notifyCompletionIfNeeded(failure);
  context.notifyCompletionIfNeeded(failure);
  await settle();
  assert.equal(dialogs.length, 1);
  assert.equal(dialogs[0].type, 'error');
  assert.match(dialogs[0].detail, /CV\.pdf et CV\.docx/);
  context.notifyCompletionIfNeeded({ ...failure, status: 'En cours...', running: true });
  context.notifyCompletionIfNeeded(failure);
  await settle();
  assert.equal(dialogs.length, 2);
});

test('missing source files produce a warning completion dialog', async () => {
  const { context, dialogs } = harness();
  context.notifyCompletionIfNeeded({
    status: 'Terminé avec erreurs', running: false, runErrors: ['Fichier absent: absent.pdf'],
    lastRunStats: { runId: 1, mode: 'members', requested: 1, recipients: 0, files: 0, missing: 1, errors: 0, outputDir: '/output' },
  });
  await settle();
  assert.equal(dialogs.length, 1);
  assert.equal(dialogs[0].type, 'warning');
  assert.match(dialogs[0].message, /terminée avec erreurs/);
  assert.match(dialogs[0].detail, /1 fichier\(s\) introuvable/);
});
