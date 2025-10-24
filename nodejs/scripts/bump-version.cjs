#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PACKAGE_JSON_PATH = path.join(__dirname, '..', 'package.json');

function exec(command, options = {}) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: 'inherit', ...options });
  } catch (error) {
    console.error(`Command failed: ${command}`);
    process.exit(1);
  }
}

function getPackageVersion() {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
  return pkg.version;
}

function bumpVersion(type) {
  const validTypes = ['patch', 'minor', 'major'];

  if (!validTypes.includes(type)) {
    console.error(`Invalid version type: ${type}`);
    console.error(`Valid types: ${validTypes.join(', ')}`);
    process.exit(1);
  }

  console.log(`\n📦 Bumping ${type} version...\n`);

  // Bump version in package.json
  exec(`npm version ${type} --no-git-tag-version`);

  const newVersion = getPackageVersion();
  console.log(`\n✅ Version bumped to: ${newVersion}\n`);

  return newVersion;
}

function main() {
  const type = process.argv[2] || 'patch';

  console.log('🚀 CAC Demat Version Bump\n');
  console.log('─────────────────────────\n');

  // Check for uncommitted changes (excluding untracked files)
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf8', stdio: 'pipe' });
    const trackedChanges = status.trim().split('\n').filter(line => line.trim() && !line.startsWith('??'));

    if (trackedChanges.length > 0) {
      console.warn('⚠️  Warning: You have uncommitted changes to tracked files.');
      console.warn('    (Untracked/new files are OK)\n');
    }
  } catch {
    // Git not available, continue anyway
  }

  const newVersion = bumpVersion(type);

  console.log('Next steps:');
  console.log('  1. Review the changes');
  console.log('  2. Run: npm run release');
  console.log('     (This will build, commit, tag, and package)');
  console.log(`\nOr manually:`);
  console.log(`  git add package.json`);
  console.log(`  git commit -m "chore: bump version to ${newVersion}"`);
  console.log(`  git tag v${newVersion}`);
  console.log(`  npm run electron:package`);
  console.log('');
}

main();

