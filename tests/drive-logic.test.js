const test = require('node:test');
const assert = require('node:assert');
const DriveLogic = require('../src/Drive.js');

test('isTranscriptJsonName matches only .transcript.json files', () => {
  assert.strictEqual(DriveLogic.isTranscriptJsonName('call.opus.transcript.json'), true);
  assert.strictEqual(DriveLogic.isTranscriptJsonName('call.opus.transcript.txt'), false);
  assert.strictEqual(DriveLogic.isTranscriptJsonName('data.json'), false);
});

test('isAudio accepts audio mime types', () => {
  assert.strictEqual(DriveLogic.isAudio('audio/ogg', 'a.opus'), true);
});

test('isAudio accepts known extensions with a generic mime type', () => {
  assert.strictEqual(DriveLogic.isAudio('application/octet-stream', 'a.opus'), true);
});

test('isAudio rejects non-audio files', () => {
  assert.strictEqual(DriveLogic.isAudio('text/plain', 'a.txt'), false);
});

test('isTranscriptName recognises transcript files only', () => {
  assert.strictEqual(DriveLogic.isTranscriptName('a.opus.transcript.txt'), true);
  assert.strictEqual(DriveLogic.isTranscriptName('notes.txt'), false);
});

test('dedupeById keeps first occurrence and order', () => {
  const out = DriveLogic.dedupeById([{ id: 'a', v: 1 }, { id: 'b', v: 2 }, { id: 'a', v: 3 }]);
  assert.deepStrictEqual(out, [{ id: 'a', v: 1 }, { id: 'b', v: 2 }]);
});
