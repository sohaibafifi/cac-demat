#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const releaseDir = path.join(__dirname, '..', 'release');

function getPackageVersion() {
  const pkgPath = path.join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return pkg.version;
}

function listReleaseAssets() {
  const version = getPackageVersion();
  console.log(`\n📦 Release Assets for v${version}\n`);
  console.log('═══════════════════════════════════════\n');

  if (!fs.existsSync(releaseDir)) {
    console.error('❌ Release directory not found. Run build first.');
    process.exit(1);
  }

  const files = fs.readdirSync(releaseDir);
  
  // Filter files for the current version
  const versionFiles = files.filter(file => {
    const stat = fs.statSync(path.join(releaseDir, file));
    return stat.isFile() && (
      file.includes(version) ||
      file.startsWith('latest') ||
      file === 'builder-debug.yml' ||
      file === 'builder-effective-config.yaml'
    );
  });

  // Categorize files
  const categories = {
    'Update Metadata (REQUIRED for auto-update)': [],
    'Installers': [],
    'Block Maps (for delta updates)': [],
    'Debug/Config (optional)': []
  };

  versionFiles.forEach(file => {
    const filePath = path.join(releaseDir, file);
    const stat = fs.statSync(filePath);
    const sizeInMB = (stat.size / (1024 * 1024)).toFixed(2);
    const fileInfo = `${file} (${sizeInMB} MB)`;

    if (file.startsWith('latest') && file.endsWith('.yml')) {
      categories['Update Metadata (REQUIRED for auto-update)'].push(fileInfo);
    } else if (file.endsWith('.blockmap')) {
      categories['Block Maps (for delta updates)'].push(fileInfo);
    } else if (file.includes('builder-')) {
      categories['Debug/Config (optional)'].push(fileInfo);
    } else {
      categories['Installers'].push(fileInfo);
    }
  });

  // Print categorized files
  Object.entries(categories).forEach(([category, files]) => {
    if (files.length > 0) {
      console.log(`\n${category}:`);
      console.log('─'.repeat(50));
      files.forEach(file => console.log(`  ✓ ${file}`));
    }
  });

  console.log('\n\n📝 Upload Instructions:');
  console.log('─'.repeat(50));
  console.log('1. Go to: https://github.com/sohaibafifi/cac-demat/releases');
  console.log('2. Create a new release or edit draft for v' + version);
  console.log('3. Upload ALL files marked as "REQUIRED for auto-update"');
  console.log('4. Upload the Installers for your target platforms');
  console.log('5. Optionally upload Block Maps for delta updates');
  console.log('\n⚠️  IMPORTANT: Without latest-*.yml files, auto-update will NOT work!\n');
}

listReleaseAssets();
