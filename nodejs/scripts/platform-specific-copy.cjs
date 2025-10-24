#!/usr/bin/env node

/**
 * Platform-specific command optimizer
 * Copies only the necessary binaries for the target platform
 */

const fs = require('fs');
const path = require('path');

const platform = process.platform; // 'darwin', 'win32', 'linux'
const commandsDir = path.join(__dirname, '..', 'commands');
const distCommandsDir = path.join(__dirname, '..', 'dist', 'resources', 'commands');

console.log(`📦 Optimizing commands for platform: ${platform}\n`);

// Ensure dist commands directory exists
if (!fs.existsSync(distCommandsDir)) {
  fs.mkdirSync(distCommandsDir, { recursive: true });
}

// Copy platform-specific binaries
const platformDir = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : 'linux';
const sourcePlatformDir = path.join(commandsDir, platformDir);

if (fs.existsSync(sourcePlatformDir)) {
  const destPlatformDir = path.join(distCommandsDir, platformDir);

  // Remove existing platform dir in dist
  if (fs.existsSync(destPlatformDir)) {
    fs.rmSync(destPlatformDir, { recursive: true });
  }

  // Copy platform-specific directory
  fs.cpSync(sourcePlatformDir, destPlatformDir, { recursive: true });
  console.log(`✓ Copied ${platformDir}/ directory`);
}

// Copy lib directory (shared libraries needed at runtime)
const sourceLibDir = path.join(commandsDir, 'lib');
const destLibDir = path.join(distCommandsDir, 'lib');

if (fs.existsSync(sourceLibDir)) {
  if (fs.existsSync(destLibDir)) {
    fs.rmSync(destLibDir, { recursive: true });
  }

  fs.mkdirSync(destLibDir, { recursive: true });

  // Copy only dynamic libraries (not .a files)
  const files = fs.readdirSync(sourceLibDir);
  let copied = 0;
  files.forEach(file => {
    const fullPath = path.join(sourceLibDir, file);
    if (fs.statSync(fullPath).isFile() && !file.endsWith('.a')) {
      fs.copyFileSync(fullPath, path.join(destLibDir, file));
      copied++;
    }
  });
  console.log(`✓ Copied ${copied} shared libraries from lib/`);
}

console.log('\n✅ Platform-specific optimization complete!');

