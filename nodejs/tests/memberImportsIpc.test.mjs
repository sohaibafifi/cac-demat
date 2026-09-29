import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../src/electron/ipcHandlers.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('ipcHandlers.ts', source, ts.ScriptTarget.Latest, true);
let registration;
function findHandler(node) {
  if (ts.isCallExpression(node) && node.arguments[0]?.text === 'coordinator:set-members-csv') registration = node.getText(ast);
  ts.forEachChild(node, findHandler);
}
findHandler(ast);
assert.ok(registration);
const script = new vm.Script(ts.transpileModule(`(function () { ${registration}; }).call(registry)`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText);

function harness() {
  const calls = [];
  let handle;
  const coordinator = { async loadMembersCsv(file, mode) { calls.push({ file, mode }); } };
  script.runInNewContext({
    registry: { ipcMain: { handle: (_name, fn) => { handle = fn; } }, getCoordinator: () => coordinator },
    serializeCoordinatorState: () => ({ updated: true }),
  });
  return { calls, handle: (...args) => handle({}, ...args) };
}

test('member IPC defaults to replacement and only appends on explicit request', async () => {
  const h = harness();
  await h.handle('/pr.csv');
  await h.handle('/mcf.csv', 'append');
  assert.deepEqual(h.calls, [{ file: '/pr.csv', mode: 'replace' }, { file: '/mcf.csv', mode: 'append' }]);
});

test('member IPC rejects malformed import modes or file paths before changing imports', async () => {
  const h = harness();
  for (const invalid of [null, '', 'merge', true, {}]) {
    await assert.rejects(() => h.handle('/pr.csv', invalid), /Mode d’import/);
  }
  for (const invalid of [null, '', ' ', {}, 2]) {
    await assert.rejects(() => h.handle(invalid), /Chemin du fichier/);
  }
  assert.equal(h.calls.length, 0);
});
