#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const sourceHtml = path.join(projectRoot, 'src', 'renderer', 'index.html');
const targetDir = path.join(projectRoot, 'dist', 'renderer');
const preloadCjsSrc = path.join(projectRoot, 'src', 'electron', 'preload.cjs');
const preloadCjsDstDir = path.join(projectRoot, 'dist', 'electron');
const bundledResourcesDst = path.join(projectRoot, 'dist', 'resources');
const commandSourceCandidates = [
  path.join(projectRoot, 'commands'),
  path.join(projectRoot, 'resources', 'commands'),
  path.join(projectRoot, '..', 'nativephp', 'resources', 'commands'),
];

const copyDirectory = (source, destination) => {
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    return false;
  }

  fs.mkdirSync(destination, { recursive: true });

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const srcPath = path.join(source, entry.name);
    const dstPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(srcPath, dstPath);
    } else if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(srcPath);
      fs.symlinkSync(target, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }

  return true;
};

if (!fs.existsSync(sourceHtml)) {
  process.exit(0);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(sourceHtml, path.join(targetDir, 'index.html'));

// Ensure CJS preload is available for Electron's require() loader
try {
  fs.mkdirSync(preloadCjsDstDir, { recursive: true });
  if (fs.existsSync(preloadCjsSrc)) {
    fs.copyFileSync(preloadCjsSrc, path.join(preloadCjsDstDir, 'preload.cjs'));
  }
} catch (err) {
  console.error('[copy-electron-assets] Failed to copy preload.cjs', err);
}

try {
  const commandsDst = path.join(bundledResourcesDst, 'commands');
  let copied = false;

  for (const candidate of commandSourceCandidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    fs.rmSync(commandsDst, { recursive: true, force: true });
    copied = copyDirectory(candidate, commandsDst);
    if (copied) {
      break;
    }
  }

  if (copied) {
    const macBinary = path.join(commandsDst, 'mac', 'qpdf');
    if (fs.existsSync(macBinary)) {
      fs.chmodSync(macBinary, 0o755);
    }
  }
} catch (err) {
  console.error('[copy-electron-assets] Failed to copy qpdf resources', err);
}
