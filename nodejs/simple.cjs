const { app } = require('electron');
app.whenReady().then(() => {
  console.log('app ready');
  app.quit();
});
