const test = require('node:test');
const assert = require('node:assert');
const GroqSpeech = require('../src/GroqSpeech.js');

test('languageCode keeps the ISO 639-1 part of a BCP-47 code', () => {
  assert.strictEqual(GroqSpeech.languageCode('cs-CZ'), 'cs');
  assert.strictEqual(GroqSpeech.languageCode('en'), 'en');
  assert.strictEqual(GroqSpeech.languageCode('fil-PH'), 'fil');
});

test('uploadName renames .opus to .ogg because Groq lists ogg but not opus', () => {
  assert.strictEqual(GroqSpeech.uploadName('call.OPUS'), 'call.ogg');
  assert.strictEqual(GroqSpeech.uploadName('call.mp3'), 'call.mp3');
  assert.strictEqual(GroqSpeech.uploadName('a.opus.opus'), 'a.opus.ogg');
});

test('buildFields asks for verbose_json (text plus timed segments) and deterministic output', () => {
  assert.deepStrictEqual(GroqSpeech.buildFields('whisper-large-v3', 'cs-CZ'),
    { model: 'whisper-large-v3', language: 'cs', response_format: 'verbose_json', temperature: '0' });
});

test('parseResponse returns the text and the whole response object', () => {
  const body = { text: ' Ahoj ', segments: [{ id: 0, start: 0, end: 1.5, text: ' Ahoj ' }], x_groq: { id: 'req_1' } };
  assert.deepStrictEqual(GroqSpeech.parseResponse(JSON.stringify(body)), { text: 'Ahoj', response: body });
  assert.strictEqual(GroqSpeech.parseResponse('<html>'), null);
  assert.strictEqual(GroqSpeech.parseResponse('{}'), null);
});

test('supports accepts the audio extensions the app lists', () => {
  ['a.opus', 'a.ogg', 'a.mp3', 'a.flac', 'a.wav', 'a.m4a', 'A.MP3'].forEach((n) => assert.strictEqual(GroqSpeech.supports(n), true, n));
  ['a.txt', 'a', 'a.aac'].forEach((n) => assert.strictEqual(GroqSpeech.supports(n), false, n));
});

test('mapStatus maps http statuses to error codes', () => {
  assert.strictEqual(GroqSpeech.mapStatus(401), 'invalidKey');
  assert.strictEqual(GroqSpeech.mapStatus(403), 'invalidKey');
  assert.strictEqual(GroqSpeech.mapStatus(413), 'tooLarge');
  assert.strictEqual(GroqSpeech.mapStatus(429), 'rateLimit');
  assert.strictEqual(GroqSpeech.mapStatus(500), 'generic');
});

test('parseText returns the transcript text, or null when the body is unusable', () => {
  assert.strictEqual(GroqSpeech.parseText(JSON.stringify({ text: ' Ahoj světe ' })), 'Ahoj světe');
  assert.strictEqual(GroqSpeech.parseText(JSON.stringify({ text: '' })), '');
  assert.strictEqual(GroqSpeech.parseText('<html>'), null);
  assert.strictEqual(GroqSpeech.parseText('{}'), null);
});

test('isValidKey accepts plausible keys only', () => {
  assert.strictEqual(GroqSpeech.isValidKey('gsk_' + 'a'.repeat(40)), true);
  assert.strictEqual(GroqSpeech.isValidKey('short'), false);
  assert.strictEqual(GroqSpeech.isValidKey('gsk_has space ' + 'a'.repeat(30)), false);
  assert.strictEqual(GroqSpeech.isValidKey(''), false);
});
