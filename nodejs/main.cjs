console.log('[main.cjs] versions.electron', process.versions.electron);
console.log('[main.cjs] typeof require("electron")', typeof require('electron'));
const electron = require('electron');
(async () => {
  try {
    const mod = await import('./dist/electron/main.js');
    const start = mod.default || mod.start || mod.bootstrap;
    if (typeof start !== 'function') {
      throw new Error('Invalid Electron main export.');
    }
    await start(electron);
  } catch (error) {
    console.error('Failed to load Electron main process:', error);
    process.exit(1);
  }
})();
