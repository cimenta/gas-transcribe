const test = require('node:test');
const assert = require('node:assert');
const Auth = require('../src/Auth.js');

test('isOwner accepts matching non-empty emails', () => {
  assert.strictEqual(Auth.isOwner('a@x.cz', 'a@x.cz'), true);
});

test('isOwner rejects empty active email', () => {
  assert.strictEqual(Auth.isOwner('', 'a@x.cz'), false);
});

test('isOwner rejects a different user', () => {
  assert.strictEqual(Auth.isOwner('b@x.cz', 'a@x.cz'), false);
});

test('isOwner rejects undefined active email', () => {
  assert.strictEqual(Auth.isOwner(undefined, 'a@x.cz'), false);
});
