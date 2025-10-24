#!/usr/bin/env node

/**
 * Optimization script to reduce app size
 * Run before packaging the application
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 Starting app size optimization...\n');

// 1. Remove static libraries from commands/lib
console.log('📦 Removing unnecessary static libraries...');
const libPath = path.join(__dirname, '..', 'commands', 'lib');
if (fs.existsSync(libPath)) {
  const files = fs.readdirSync(libPath);
  let removed = 0;
  files.forEach(file => {
    if (file.endsWith('.a')) {
      fs.unlinkSync(path.join(libPath, file));
      removed++;
    }
  });
  console.log(`   ✓ Removed ${removed} static library files\n`);
}

// 2. Remove unnecessary cmake and pkgconfig directories
console.log('📦 Removing build configuration files...');
const dirsToRemove = [
  path.join(libPath, 'cmake'),
  path.join(libPath, 'pkgconfig')
];
dirsToRemove.forEach(dir => {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`   ✓ Removed ${path.basename(dir)}/`);
  }
});
console.log('');

// 3. Clean dist directory
console.log('🧹 Cleaning build artifacts...');
const distPath = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distPath)) {
  // Remove .map files
  const removeMapFiles = (dir) => {
    const files = fs.readdirSync(dir);
    files.forEach(file => {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        removeMapFiles(fullPath);
      } else if (file.endsWith('.map')) {
        fs.unlinkSync(fullPath);
      }
    });
  };
  removeMapFiles(distPath);
  console.log('   ✓ Removed source map files\n');
}

// 4. Show size summary
console.log('📊 Size summary:');
const getSizeMB = (dir) => {
  try {
    const output = execSync(`du -sm "${dir}"`, { encoding: 'utf8' });
    return parseInt(output.split('\t')[0]);
  } catch (e) {
    return 0;
  }
};

const projectRoot = path.join(__dirname, '..');
const commandsSize = getSizeMB(path.join(projectRoot, 'commands'));
const distSize = fs.existsSync(distPath) ? getSizeMB(distPath) : 0;

console.log(`   Commands:  ${commandsSize} MB`);
console.log(`   Dist:      ${distSize} MB`);
console.log('');

console.log('✅ Optimization complete!\n');
console.log('💡 Tips to further reduce size:');
console.log('   • Use electron-builder with compression: "maximum"');
console.log('   • Package only platform-specific binaries (mac/ or win/)');
console.log('   • Consider removing unused Electron features');
console.log('');

