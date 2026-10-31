const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { APP_VERSION } = require('../src/Version.js');

test('APP_VERSION is MAJOR.MINOR.PATCH', () => {
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
});

test('package.json version equals APP_VERSION', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  assert.strictEqual(pkg.version, APP_VERSION);
});

test('Version.js keeps the one-line form the .bat scripts parse', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/Version.js'), 'utf8');
  assert.match(src, /^const APP_VERSION = '\d+\.\d+\.\d+';$/m);
});
