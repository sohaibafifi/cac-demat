const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const baseIconPath = path.join(__dirname, 'assets', 'icon');

const buildIgnoredPatterns = (directory) => {
  const platforms = ['mac', 'win', 'linux'];
  const archivePattern = '\\.(zip|dmg|exe|msi)$';

  return [
    ...platforms.map((platform) => new RegExp(`${directory}/${platform}-.*`, 'i')),
    new RegExp(`${directory}/.*${archivePattern}`, 'i'),
  ];
};

const ignoredPatterns = ['dist', 'release'].flatMap(buildIgnoredPatterns);

const iconExists = ['.icns', '.ico'].some((ext) => fs.existsSync(`${baseIconPath}${ext}`));

const packagerConfig = {
  asar: {
    unpackDir: 'dist/resources/commands',
  },
  ignore: (filePath) => {
    const normalized = filePath.replace(/\\/g, '/');

    // Ignore build directories
    if (ignoredPatterns.some((pattern) => pattern.test(normalized))) {
      return true;
    }

    // Ignore all node_modules (no dependencies needed at runtime)
    if (normalized.includes('node_modules')) {
      if (normalized.includes('dist/node_modules')) {
        return false;
      }
      return true;
    }

    // Ignore source files
    if (normalized.includes('/src/') || normalized.includes('tsconfig.json')) {
      return true;
    }

    // Ignore unnecessary library files
    if (normalized.includes('.a') && normalized.includes('commands/lib')) {
      return true;
    }

    // Ignore map files
    return normalized.endsWith('.map');
  },
  afterCopy: [
    (buildPath, electronVersion, platform, arch, callback) => {
      // Map platform to folder names
      const platformMap = {
        'darwin': 'mac',
        'win32': 'win',
        'linux': 'linux',
        'mas': 'mac'
      };

      const targetPlatform = platformMap[platform];
      const commandsPath = path.join(buildPath, 'dist', 'resources', 'commands');

      if (fs.existsSync(commandsPath)) {
        console.log(`Cleaning up commands for platform: ${targetPlatform}`);

        // Remove other platform folders
        const allPlatforms = ['mac', 'win', 'linux'];
        const platformsToRemove = allPlatforms.filter(p => p !== targetPlatform);

        for (const platformToRemove of platformsToRemove) {
          const platformDir = path.join(commandsPath, platformToRemove);
          if (fs.existsSync(platformDir)) {
            console.log(`  Removing unnecessary platform: ${platformToRemove}`);
            fs.rmSync(platformDir, { recursive: true, force: true });
          }
        }

        // Remove lib folder for Windows and Linux (only macOS needs it)
        if (targetPlatform === 'win' || targetPlatform === 'linux') {
          const libDir = path.join(commandsPath, 'lib');
          if (fs.existsSync(libDir)) {
            console.log(`  Removing lib folder (not needed for ${targetPlatform})`);
            fs.rmSync(libDir, { recursive: true, force: true });
          }
        }

        // Verify the correct platform folder exists
        const correctPlatformDir = path.join(commandsPath, targetPlatform);
        if (fs.existsSync(correctPlatformDir)) {
          const contents = fs.readdirSync(commandsPath);
          console.log(`  ✓ Final contents: ${contents.join(', ')}`);
        }
      }

      callback();
    }
  ],
  ...(iconExists ? { icon: baseIconPath } : {}),
};

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
const config = {
  packagerConfig,
  rebuildConfig: {},
  hooks: {
    prePackage: async () => {
      execSync('npm run build', { cwd: __dirname, stdio: 'inherit' });
    },
  },
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
      config: {
        format: 'ULFO', // Use ULFO for better compression
      },
    },
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: {
        name: 'cac-demat-node',
        authors: 'Université d\'Artois',
        setupExe: 'cac-demat-node-setup.exe',
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32'],
    },
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'sohaibafifi',
          name: 'cac-demat',
        },
        prerelease: false,
        draft: true,
      },
    },
  ],
};

module.exports = config;
