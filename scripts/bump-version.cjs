#!/usr/bin/env node

/**
 * Met à jour la version NodeJS/Electron.
 * Utilisation :
 *   node scripts/bump-version.cjs patch|minor|major
 *   node scripts/bump-version.cjs 1.2.3
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const nodeDir = path.join(repoRoot, 'nodejs');

function exec(command, cwd) {
  return execSync(command, { stdio: 'inherit', cwd });
}

function readNodeVersion() {
  const pkgPath = path.join(nodeDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return pkg.version;
}

function bumpNodeVersion(target) {
  const validTypes = ['patch', 'minor', 'major'];
  const semverRegex = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;

  if (!validTypes.includes(target) && !semverRegex.test(target)) {
    console.error(`❌ Type "${target}" invalide. Utiliser ${validTypes.join(', ')} ou une version explicite.`);
    process.exit(1);
  }

  exec(`npm version ${target} --no-git-tag-version`, nodeDir);
  return readNodeVersion();
}

function main() {
  const target = (process.argv[2] || 'patch').toLowerCase();

  console.log('🚀 Mise à jour de version NodeJS/Electron\n');
  const newVersion = bumpNodeVersion(target);

  console.log(`📦 Nouvelle version: ${newVersion}`);

  console.log('\n📝 Fichiers mis à jour :');
  console.log(`  - nodejs/package.json + package-lock.json`);

  console.log('\nÉtapes suivantes :');
  console.log('  1. Vérifier les changements git');
  console.log('  2. Lancer npm run release');
  console.log('');
}

main();
