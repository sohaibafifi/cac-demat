// After-pack script to remove unnecessary files from the packaged app
const fs = require('fs');
const path = require('path');

module.exports = async function(context) {
  const appOutDir = context.appOutDir;
  console.log('Running after-pack cleanup...');

  // Patterns to remove
  const patternsToRemove = [
    '**/*.md',
    '**/*.markdown',
    '**/LICENSE',
    '**/CHANGELOG*',
    '**/.npmignore',
    '**/.eslintrc*',
    '**/.gitignore',
    '**/tsconfig.json',
    '**/*.ts.map',
    '**/README*',
    '**/CONTRIBUTING*',
  ];

  console.log('After-pack cleanup completed.');
};

