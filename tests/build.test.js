const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('src/LogicClient.html is in sync with src/Logic.js (run `npm run build`)', () => {
  const logic = fs.readFileSync(path.join(__dirname, '../src/Logic.js'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, '../src/LogicClient.html'), 'utf8');
  assert.strictEqual(client, '<script>\n' + logic + '</script>\n');
});
