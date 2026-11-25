const test = require('node:test');
const assert = require('node:assert');
const Upload = require('../src/Upload.js');

test('cleanName keeps the base name, drops control characters and limits the length', () => {
  assert.strictEqual(Upload.cleanName('C:\\Users\\me\\hovor č. 1.opus'), 'hovor č. 1.opus');
  assert.strictEqual(Upload.cleanName('../../x/a.mp3'), 'a.mp3');
  assert.strictEqual(Upload.cleanName('a\u0000b\n.wav'), 'ab.wav');
  assert.strictEqual(Upload.cleanName('   '), null);
  assert.strictEqual(Upload.cleanName(''), null);
  const long = Upload.cleanName('x'.repeat(400) + '.opus');
  assert.strictEqual(long.length, 200);
  assert.ok(long.endsWith('.opus'));
});

test('validate accepts supported audio within the size limit', () => {
  assert.deepStrictEqual(Upload.validate('call.OPUS', 1000), { ok: true, name: 'call.OPUS' });
  assert.deepStrictEqual(Upload.validate('call.opus', Upload.MAX_BYTES), { ok: true, name: 'call.opus' });
});

test('validate rejects unknown formats, empty and oversized files', () => {
  assert.deepStrictEqual(Upload.validate('notes.txt', 1000), { ok: false, code: 'unsupportedFormat' });
  assert.deepStrictEqual(Upload.validate('', 1000), { ok: false, code: 'unsupportedFormat' });
  assert.deepStrictEqual(Upload.validate('a.opus', 0), { ok: false, code: 'generic' });
  assert.deepStrictEqual(Upload.validate('a.opus', 1.5), { ok: false, code: 'generic' });
  assert.deepStrictEqual(Upload.validate('a.opus', Upload.MAX_BYTES + 1), { ok: false, code: 'uploadTooLarge' });
});

test('uniqueName adds a counter before the extension when the name is taken', () => {
  assert.strictEqual(Upload.uniqueName('a.opus', {}), 'a.opus');
  assert.strictEqual(Upload.uniqueName('a.opus', { 'a.opus': true }), 'a (1).opus');
  assert.strictEqual(Upload.uniqueName('a.opus', { 'a.opus': true, 'a (1).opus': true }), 'a (2).opus');
  assert.strictEqual(Upload.uniqueName('noext', { noext: true }), 'noext (1)');
});

test('contentRange describes the bytes of a chunk', () => {
  assert.strictEqual(Upload.contentRange(0, 262144, 1000000), 'bytes 0-262143/1000000');
  assert.strictEqual(Upload.contentRange(262144, 737856, 1000000), 'bytes 262144-999999/1000000');
});

test('chunkOk needs the expected offset and 256 KiB multiples except for the last chunk', () => {
  const total = 1000000;
  assert.strictEqual(Upload.chunkOk(0, 262144, total, 0), true);
  assert.strictEqual(Upload.chunkOk(262144, 262144, total, 262144), true);
  assert.strictEqual(Upload.chunkOk(786432, 213568, total, 786432), true);
  assert.strictEqual(Upload.chunkOk(0, 1000, total, 0), false);
  assert.strictEqual(Upload.chunkOk(262144, 262144, total, 0), false);
  assert.strictEqual(Upload.chunkOk(786432, 262144, total, 786432), false);
  assert.strictEqual(Upload.chunkOk(0, 0, total, 0), false);
});

test('the chunk size is a multiple of 256 KiB, as the resumable upload requires', () => {
  assert.strictEqual(Upload.CHUNK_BYTES % 262144, 0);
});

test('sessionLocation finds the Location header whatever its case', () => {
  assert.strictEqual(Upload.sessionLocation({ Location: 'https://up/1' }), 'https://up/1');
  assert.strictEqual(Upload.sessionLocation({ location: 'https://up/2' }), 'https://up/2');
  assert.strictEqual(Upload.sessionLocation({ Other: 'x' }), null);
  assert.strictEqual(Upload.sessionLocation(null), null);
});
