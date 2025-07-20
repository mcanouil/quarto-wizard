#!/usr/bin/env node

console.log('Starting simple test verification...');

// Test that our compiled files exist
const fs = require('fs');
const path = require('path');

const testFiles = [
  'out/test/suite/index.js',
  'out/test/suite/extension.test.js',
  'out/test/suite/hash.test.js',
  'out/test/suite/quarto.test.js'
];

let allFilesExist = true;

testFiles.forEach(file => {
  if (fs.existsSync(path.join(__dirname, '..', file))) {
    console.log('✓', file, 'exists');
  } else {
    console.log('✗', file, 'missing');
    allFilesExist = false;
  }
});

if (allFilesExist) {
  console.log('✓ All test files compiled successfully');
} else {
  console.log('✗ Some test files are missing');
  process.exit(1);
}
