#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');

try {
  fs.rmSync(distDir, { recursive: true, force: true });
  console.log('[clean-dist] Removed existing dist directory');
} catch (error) {
  console.warn('[clean-dist] Failed to remove dist directory:', error);
}
