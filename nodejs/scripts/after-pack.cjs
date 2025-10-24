// After-pack script to remove unnecessary files and copy platform-specific commands
const fs = require('fs');
const path = require('path');

const copyDirectory = (source, destination, filterFn = null) => {
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    return false;
  }

  fs.mkdirSync(destination, { recursive: true });

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const srcPath = path.join(source, entry.name);
    const dstPath = path.join(destination, entry.name);

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

const cleanupPlatformSpecificCommands = (commandsDst, targetPlatform) => {
  if (!fs.existsSync(commandsDst)) {
    return false;
  }

  console.log(`  Cleaning up: ${commandsDst}`);

  // Remove other platform folders
  const allPlatforms = ['mac', 'win', 'linux'];
  const platformsToRemove = allPlatforms.filter(p => p !== targetPlatform);

  for (const platformToRemove of platformsToRemove) {
    const platformDir = path.join(commandsDst, platformToRemove);
    if (fs.existsSync(platformDir)) {
      console.log(`    Removing unnecessary platform: ${platformToRemove}`);
      fs.rmSync(platformDir, { recursive: true, force: true });
    }
  }

  // Remove lib folder for Windows and Linux (only macOS needs it)
  if (targetPlatform === 'win' || targetPlatform === 'linux') {
    const libDir = path.join(commandsDst, 'lib');
    if (fs.existsSync(libDir)) {
      console.log(`    Removing lib folder (not needed for ${targetPlatform})`);
      fs.rmSync(libDir, { recursive: true, force: true });
    }
  }

  // Verify the correct platform folder exists
  const correctPlatformDir = path.join(commandsDst, targetPlatform);
  if (fs.existsSync(correctPlatformDir)) {
    const contents = fs.readdirSync(commandsDst);
    console.log(`    ✓ Final contents: ${contents.join(', ')}`);
    return true;
  } else {
    console.error(`    ✗ Missing platform commands for: ${targetPlatform}`);
    return false;
  }
};

module.exports = async function(context) {
  const appOutDir = context.appOutDir;
  const platform = context.electronPlatformName; // 'darwin', 'win32', 'linux', 'mas'

  console.log(`Running after-pack for platform: ${platform}`);

  // Map electron platform names to our folder names
  const platformMap = {
    'darwin': 'mac',
    'win32': 'win',
    'linux': 'linux',
    'mas': 'mac'
  };

  const targetPlatform = platformMap[platform];

  if (!targetPlatform) {
    console.warn(`Unknown platform: ${platform}, skipping command copy`);
    return;
  }

  console.log(`Target platform: ${targetPlatform}`);

  // Find ALL possible command destinations in the packaged app
  const commandLocations = [];

  if (platform === 'darwin' || platform === 'mas') {
    // macOS locations
    commandLocations.push(
      path.join(appOutDir, 'CAC Demat.app', 'Contents', 'Resources', 'resources', 'commands'),
      path.join(appOutDir, 'CAC Demat.app', 'Contents', 'Resources', 'app.asar.unpacked', 'dist', 'resources', 'commands')
    );
  } else if (platform === 'win32') {
    // Windows locations
    commandLocations.push(
      path.join(appOutDir, 'resources', 'resources', 'commands'),
      path.join(appOutDir, 'resources', 'app.asar.unpacked', 'dist', 'resources', 'commands')
    );
  } else if (platform === 'linux') {
    // Linux locations
    commandLocations.push(
      path.join(appOutDir, 'resources', 'resources', 'commands'),
      path.join(appOutDir, 'resources', 'app.asar.unpacked', 'dist', 'resources', 'commands')
    );
  }

  let cleanedCount = 0;

  // Clean up ALL command locations
  for (const commandsDst of commandLocations) {
    if (cleanupPlatformSpecificCommands(commandsDst, targetPlatform)) {
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    console.log(`✓ Successfully cleaned ${cleanedCount} command location(s)`);
  } else {
    console.warn('⚠ No command directories found to clean up');
  }

  console.log('After-pack cleanup completed.');
};
