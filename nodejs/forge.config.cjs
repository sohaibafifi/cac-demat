import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const baseIconPath = path.join(__dirname, 'assets', 'icon');
const ignoredPatterns = [
  /dist\/mac-.*/i,
  /dist\/win-.*/i,
  /dist\/linux-.*/i,
  /dist\/.*\.(zip|dmg|exe|msi)$/i,
];
const packagerConfig = {
  asar: true,
  ignore: (filePath) => {
    const normalized = filePath.replace(/\\/g, '/');
    return ignoredPatterns.some((pattern) => pattern.test(normalized));
  },
};
if (fs.existsSync(`${baseIconPath}.icns`) || fs.existsSync(`${baseIconPath}.ico`)) {
  packagerConfig.icon = baseIconPath;
}

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
    },
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: {
        name: 'cac_demat',
        setupExe: 'CAC-Demat-Setup.exe',
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

export default config;
