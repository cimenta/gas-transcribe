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

test('resultInfo reads kind and provider from a result file name', () => {
  assert.deepStrictEqual(DriveLogic.resultInfo('a.opus.transcript.groq.txt'), { kind: 'txt', provider: 'groq' });
  assert.deepStrictEqual(DriveLogic.resultInfo('a.opus.transcript.google-speech.json'), { kind: 'json', provider: 'google-speech' });
  assert.deepStrictEqual(DriveLogic.resultInfo('a.opus.transcript.txt'), { kind: 'txt', provider: '' });
  assert.deepStrictEqual(DriveLogic.resultInfo('a.opus.transcript.json'), { kind: 'json', provider: '' });
  assert.strictEqual(DriveLogic.resultInfo('notes.txt'), null);
  assert.strictEqual(DriveLogic.resultInfo('a.transcript.groq.mp3'), null);
});

test('name checks accept provider-tagged result files', () => {
  assert.strictEqual(DriveLogic.isTranscriptName('a.opus.transcript.deepgram.txt'), true);
  assert.strictEqual(DriveLogic.isTranscriptName('a.opus.transcript.deepgram.json'), false);
  assert.strictEqual(DriveLogic.isTranscriptJsonName('a.opus.transcript.deepgram.json'), true);
  assert.strictEqual(DriveLogic.isTranscriptJsonName('a.opus.transcript.deepgram.txt'), false);
});

test('resultsFor lists one entry per provider with its JSON flag, sorted by provider', () => {
  const jsonNames = { 'f1/a.opus.transcript.groq.json': true };
  const entries = [{ provider: 'groq' }, { provider: 'deepgram' }, { provider: '' }];
  assert.deepStrictEqual(DriveLogic.resultsFor('a.opus', 'f1', entries, jsonNames), [
    { provider: '', hasJson: false },
    { provider: 'deepgram', hasJson: false },
    { provider: 'groq', hasJson: true },
  ]);
  assert.deepStrictEqual(DriveLogic.resultsFor('a.opus', 'f1', undefined, jsonNames), []);
});

test('hasResult checks one provider', () => {
  const results = [{ provider: 'groq', hasJson: true }];
  assert.strictEqual(DriveLogic.hasResult(results, 'groq'), true);
  assert.strictEqual(DriveLogic.hasResult(results, 'deepgram'), false);
});

test('planMigration gives legacy results the provider of the legacy JSON, else google-speech', () => {
  const entries = [
    { id: 't1', folderId: 'f', name: 'a.opus.transcript.txt', kind: 'txt', audioFileId: 'A' },
    { id: 'j1', folderId: 'f', name: 'a.opus.transcript.json', kind: 'json', audioFileId: 'A', provider: 'groq' },
    { id: 't2', folderId: 'f', name: 'b.opus.transcript.txt', kind: 'txt', audioFileId: 'B' },
  ];
  assert.deepStrictEqual(DriveLogic.planMigration(entries, {}), [
    { id: 't1', newName: 'a.opus.transcript.groq.txt' },
    { id: 'j1', newName: 'a.opus.transcript.groq.json' },
    { id: 't2', newName: 'b.opus.transcript.google-speech.txt' },
  ]);
});

test('planMigration leaves tagged files alone and skips a name that is already taken', () => {
  const entries = [
    { id: 't1', folderId: 'f', name: 'a.opus.transcript.groq.txt', kind: 'txt', audioFileId: 'A' },
    { id: 't2', folderId: 'f', name: 'b.opus.transcript.txt', kind: 'txt', audioFileId: 'B' },
  ];
  const taken = { 'f/b.opus.transcript.google-speech.txt': true };
  assert.deepStrictEqual(DriveLogic.planMigration(entries, taken), []);
});
