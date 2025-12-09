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
const iconSourceDirs = [
  path.join(projectRoot, 'build'),
  path.join(projectRoot, '..', 'nativephp', 'public'),
];
const iconFiles = ['icon.png', 'icon.ico', 'icon.icns'];
const iconDstDir = path.join(projectRoot, 'dist', 'assets');

const platform = process.platform; // 'darwin', 'win32', 'linux'
const bundledNodeModules = ['xlsx', 'electron-updater'];

// Helper to collect all dependencies recursively
const collectDependencies = (moduleName, visited = new Set()) => {
  if (visited.has(moduleName)) return [];
  visited.add(moduleName);
  
  const modulePath = path.join(projectRoot, 'node_modules', moduleName);
  const packageJsonPath = path.join(modulePath, 'package.json');
  
  if (!fs.existsSync(packageJsonPath)) return [moduleName];
  
  const deps = [moduleName];
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const dependencies = packageJson.dependencies || {};
    
    for (const dep of Object.keys(dependencies)) {
      deps.push(...collectDependencies(dep, visited));
    }
  } catch (err) {
    console.error(`Failed to read dependencies for ${moduleName}:`, err.message);
  }
  
  return deps;
};

const copyDirectory = (source, destination, filterFn = null) => {
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    return false;
  }

  fs.mkdirSync(destination, { recursive: true });

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const srcPath = path.join(source, entry.name);
    const dstPath = path.join(destination, entry.name);

    // Apply filter if provided
    if (filterFn && !filterFn(srcPath, entry)) {
      continue;
    }

    if (entry.isDirectory()) {
      copyDirectory(srcPath, dstPath, filterFn);
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

fs.mkdirSync(iconDstDir, { recursive: true });
let copiedIcons = 0;
for (const iconFile of iconFiles) {
  for (const srcDir of iconSourceDirs) {
    const candidate = path.join(srcDir, iconFile);
    if (fs.existsSync(candidate)) {
      fs.copyFileSync(candidate, path.join(iconDstDir, iconFile));
      copiedIcons += 1;
      console.log(`[copy-electron-assets] Copied ${iconFile} from ${path.relative(projectRoot, srcDir) || '.'}`);
      break;
    }
  }
}

if (copiedIcons === 0) {
  console.warn('[copy-electron-assets] No icon assets found; Electron will fall back to defaults.');
}

const copyNodeModule = (moduleName) => {
  const source = path.join(projectRoot, 'node_modules', moduleName);
  const destination = path.join(projectRoot, 'dist', 'node_modules', moduleName);
  if (!fs.existsSync(source)) {
    return;
  }

  fs.rmSync(destination, { recursive: true, force: true });
  copyDirectory(source, destination);
};

fs.mkdirSync(path.join(projectRoot, 'dist', 'node_modules'), { recursive: true });

// Collect all dependencies recursively
const allModules = new Set();
for (const moduleName of bundledNodeModules) {
  const deps = collectDependencies(moduleName);
  deps.forEach(dep => allModules.add(dep));
}

console.log(`Copying ${allModules.size} modules (including dependencies):`, Array.from(allModules).join(', '));

for (const moduleName of allModules) {
  copyNodeModule(moduleName);
}

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

    // Always copy ALL platform binaries during build
    // The after-pack.cjs script will remove the ones we don't need per platform
    const shouldCopy = (srcPath, entry) => {
      const relativePath = path.relative(candidate, srcPath);
      const parts = relativePath.split(path.sep);

      // Always copy lib directory (after-pack will remove if not needed)
      if (parts[0] === 'lib') {
        if (entry.isDirectory()) return true;
        if (entry.name.endsWith('.a')) return false; // Exclude static libraries
        if (entry.name.endsWith('.cmake')) return false;
        return true;
      }

      // Always copy all platform directories
      // The after-pack script will clean up the unnecessary ones
      if (parts[0] === 'mac' || parts[0] === 'win' || parts[0] === 'linux') {
        return true;
      }

      return true;
    };

    copied = copyDirectory(candidate, commandsDst, shouldCopy);
    if (copied) {
      console.log(`✓ Copied commands for all platforms (mac, win, linux, lib)`);
      break;
    }
  }

  if (copied) {
    // Set executable permissions for all platform binaries
    const macBinary = path.join(commandsDst, 'mac', 'qpdf');
    if (fs.existsSync(macBinary)) {
      fs.chmodSync(macBinary, 0o755);
    }

    const winBinary = path.join(commandsDst, 'win', 'qpdf.exe');
    if (fs.existsSync(winBinary)) {
      fs.chmodSync(winBinary, 0o755);
    }

    const linuxBinary = path.join(commandsDst, 'linux', 'qpdf');
    if (fs.existsSync(linuxBinary)) {
      fs.chmodSync(linuxBinary, 0o755);
    }
  }
} catch (err) {
  console.error('[copy-electron-assets] Failed to copy qpdf resources', err);
}
