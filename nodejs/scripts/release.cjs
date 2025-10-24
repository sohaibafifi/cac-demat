#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PACKAGE_JSON_PATH = path.join(__dirname, '..', 'package.json');

function exec(command, options = {}) {
  try {
    console.log(`\n▶ ${command}\n`);
    return execSync(command, { encoding: 'utf8', stdio: 'inherit', ...options });
  } catch (error) {
    console.error(`\n❌ Command failed: ${command}`);
    process.exit(1);
  }
}

function getPackageVersion() {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
  return pkg.version;
}

function checkGitStatus() {
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf8', stdio: 'pipe' });
    const lines = status.trim().split('\n').filter(line => line.trim());

    // Filter out untracked files (lines starting with ??)
    const trackedChanges = lines.filter(line => !line.startsWith('??'));

    // Check if only package.json is modified (among tracked files)
    const onlyPackageJson = trackedChanges.every(line => line.includes('package.json'));

    if (trackedChanges.length > 0 && !onlyPackageJson) {
      console.error('\n❌ You have uncommitted changes to tracked files (other than package.json).');
      console.error('Please commit or stash them before releasing.\n');
      console.log('Changed tracked files:');
      trackedChanges.forEach(line => console.log(`  ${line}`));
      console.log('\nNote: Untracked files (new files) are OK and will be ignored.\n');
      process.exit(1);
    }

    return trackedChanges.length > 0;
  } catch (error) {
    console.error('❌ Git is not initialized or not available.');
    process.exit(1);
  }
}

function main() {
  console.log('🚀 CAC Demat Release Process\n');
  console.log('═════════════════════════════\n');

  const version = getPackageVersion();
  console.log(`📦 Current version: ${version}\n`);

  // Check git status
  const hasChanges = checkGitStatus();

  // Build the application
  console.log('🔨 Building application...\n');
  exec('npm run build');

  // Commit version bump if there are changes
  if (hasChanges) {
    console.log('\n📝 Committing version bump...\n');
    exec('git add package.json package-lock.json');
    exec(`git commit -m "chore: release version ${version}"`);
  }

  // Create git tag
  console.log(`\n🏷️  Creating git tag v${version}...\n`);
  try {
    exec(`git tag -a v${version} -m "Release version ${version}"`);
  } catch (error) {
    console.log('⚠️  Tag might already exist, continuing...');
  }

  // Package the application
  console.log('\n📦 Packaging application with electron-builder...\n');
  exec('npm run electron:package');

  console.log('\n✅ Release process completed!\n');
  console.log('─────────────────────────────\n');
  console.log(`Version: ${version}`);
  console.log(`Tag: v${version}`);
  console.log(`Artifacts: ./release/\n`);
  console.log('Next steps:');
  console.log('  1. Test the packaged application in ./release/');
  console.log('  2. Push to remote: git push && git push --tags');
  console.log('  3. Create a GitHub release with the artifacts\n');
}

main();