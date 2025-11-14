#!/usr/bin/env node

/**
 * Synchronise la version entre nodejs (Electron) et nativephp.
 * Utilisation :
 *   node scripts/bump-version.cjs patch|minor|major
 *   node scripts/bump-version.cjs 1.2.3
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const nodeDir = path.join(repoRoot, 'nodejs');
const nativeDir = path.join(repoRoot, 'nativephp');

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

function updateEnvVersion(filePath, version) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const regex = /^NATIVEPHP_APP_VERSION=.*$/m;
  const replacement = `NATIVEPHP_APP_VERSION=${version}`;
  let updated;

  if (regex.test(content)) {
    updated = content.replace(regex, replacement);
  } else {
    updated = `${content.trim()}\n${replacement}\n`;
  }

  fs.writeFileSync(filePath, updated);
  return true;
}

function updateNativePackage(version) {
  const pkgPath = path.join(nativeDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return false;
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.version = version;
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 4)}\n`);
  return true;
}

function main() {
  const target = (process.argv[2] || 'patch').toLowerCase();

  console.log('🚀 Synchronisation de version (NodeJS ↔ NativePHP)\n');
  const newVersion = bumpNodeVersion(target);

  console.log(`📦 Nouvelle version: ${newVersion}`);

  const envExample = path.join(nativeDir, '.env.example');
  const envLocal = path.join(nativeDir, '.env');

  const touched = [];
  if (updateEnvVersion(envExample, newVersion)) {
    touched.push('.env.example');
  }
  if (updateEnvVersion(envLocal, newVersion)) {
    touched.push('.env');
  }
  if (updateNativePackage(newVersion)) {
    touched.push('package.json (nativephp)');
  }

  console.log('\n📝 Fichiers mis à jour :');
  console.log(`  - nodejs/package.json + package-lock.json`);
  touched.forEach(file => console.log(`  - nativephp/${file}`));

  console.log('\nÉtapes suivantes :');
  console.log('  1. Vérifier les changements git');
  console.log('  2. Lancer npm run release (root) ou un release ciblé');
  console.log('');
}

main();
