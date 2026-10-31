const test = require('node:test');
const assert = require('node:assert');
const DeepgramSpeech = require('../src/DeepgramSpeech.js');

test('languageCode keeps the primary language subtag', () => {
  assert.strictEqual(DeepgramSpeech.languageCode('cs-CZ'), 'cs');
  assert.strictEqual(DeepgramSpeech.languageCode('en'), 'en');
});

test('buildQuery asks for punctuation, utterances and opts out of model improvement', () => {
  assert.strictEqual(DeepgramSpeech.buildQuery('nova-3', 'cs-CZ'),
    'model=nova-3&language=cs&smart_format=true&punctuate=true&utterances=true&mip_opt_out=true');
});

test('contentType follows the extension, opus is an Ogg container', () => {
  assert.strictEqual(DeepgramSpeech.contentType('a.OPUS'), 'audio/ogg');
  assert.strictEqual(DeepgramSpeech.contentType('a.ogg'), 'audio/ogg');
  assert.strictEqual(DeepgramSpeech.contentType('a.mp3'), 'audio/mpeg');
  assert.strictEqual(DeepgramSpeech.contentType('a.flac'), 'audio/flac');
  assert.strictEqual(DeepgramSpeech.contentType('a.wav'), 'audio/wav');
  assert.strictEqual(DeepgramSpeech.contentType('a.m4a'), 'audio/mp4');
  assert.strictEqual(DeepgramSpeech.contentType('a.xyz'), 'application/octet-stream');
});

test('supports the common audio extensions only', () => {
  ['a.opus', 'a.ogg', 'a.mp3', 'a.flac', 'a.wav', 'a.m4a', 'a.aac', 'A.MP3'].forEach((n) => assert.strictEqual(DeepgramSpeech.supports(n), true, n));
  ['a.txt', 'a', 'a.json'].forEach((n) => assert.strictEqual(DeepgramSpeech.supports(n), false, n));
});

test('mapStatus maps auth, credit, size and rate limit errors', () => {
  assert.strictEqual(DeepgramSpeech.mapStatus(401), 'invalidKey');
  assert.strictEqual(DeepgramSpeech.mapStatus(403), 'invalidKey');
  assert.strictEqual(DeepgramSpeech.mapStatus(402), 'noCredit');
  assert.strictEqual(DeepgramSpeech.mapStatus(413), 'tooLarge');
  assert.strictEqual(DeepgramSpeech.mapStatus(429), 'rateLimit');
  assert.strictEqual(DeepgramSpeech.mapStatus(400), 'generic');
  assert.strictEqual(DeepgramSpeech.mapStatus(500), 'generic');
});

test('errorMessage reads err_msg and is capped at 500 characters', () => {
  assert.strictEqual(DeepgramSpeech.errorMessage(JSON.stringify({ err_code: 'X', err_msg: 'Bad language' })), 'Bad language');
  assert.strictEqual(DeepgramSpeech.errorMessage(JSON.stringify({ err_msg: 'x'.repeat(900) })).length, 500);
  assert.strictEqual(DeepgramSpeech.errorMessage('<html>'), '');
  assert.strictEqual(DeepgramSpeech.errorMessage('{}'), '');
});

const body = {
  metadata: { duration: 12.5 },
  results: {
    channels: [{ alternatives: [{ transcript: ' Ahoj světe ' }] }],
    utterances: [{ start: 0, end: 5.2, transcript: 'Ahoj' }, { start: 5.2, end: 12.5, transcript: 'světe' }],
  },
};

test('parseResponse returns the trimmed transcript and the untouched response', () => {
  assert.deepStrictEqual(DeepgramSpeech.parseResponse(JSON.stringify(body)), { text: 'Ahoj světe', response: body });
});

test('parseResponse accepts an empty transcript and rejects a malformed response', () => {
  const empty = { results: { channels: [{ alternatives: [{ transcript: '' }] }] } };
  assert.strictEqual(DeepgramSpeech.parseResponse(JSON.stringify(empty)).text, '');
  assert.strictEqual(DeepgramSpeech.parseResponse('<html>'), null);
  assert.strictEqual(DeepgramSpeech.parseResponse('{}'), null);
  assert.strictEqual(DeepgramSpeech.parseResponse(JSON.stringify({ results: { channels: [] } })), null);
});

test('exceedsLimit guards the 50 MB request size of UrlFetch', () => {
  assert.strictEqual(DeepgramSpeech.exceedsLimit(50 * 1024 * 1024), false);
  assert.strictEqual(DeepgramSpeech.exceedsLimit(50 * 1024 * 1024 + 1), true);
});

test('isValidKey accepts an ordinary key and rejects junk', () => {
  assert.strictEqual(DeepgramSpeech.isValidKey('a1b2c3d4'.repeat(5)), true);
  assert.strictEqual(DeepgramSpeech.isValidKey('short'), false);
  assert.strictEqual(DeepgramSpeech.isValidKey('has space ' + 'a'.repeat(30)), false);
  assert.strictEqual(DeepgramSpeech.isValidKey(''), false);
});

test('parseProjectId takes the first project', () => {
  const body = { projects: [{ project_id: 'p-1', name: 'a' }, { project_id: 'p-2' }] };
  assert.strictEqual(DeepgramSpeech.parseProjectId(JSON.stringify(body)), 'p-1');
  assert.strictEqual(DeepgramSpeech.parseProjectId(JSON.stringify({ projects: [] })), null);
  assert.strictEqual(DeepgramSpeech.parseProjectId('<html>'), null);
});

test('parseBalance sums the balances in the first unit', () => {
  const body = { balances: [{ amount: 199.98815556, units: 'usd' }, { amount: 0.5, units: 'usd' }, { amount: 9, units: 'eur' }] };
  assert.deepStrictEqual(DeepgramSpeech.parseBalance(JSON.stringify(body)), { amount: 200.48815556, units: 'usd' });
  assert.deepStrictEqual(DeepgramSpeech.parseBalance(JSON.stringify({ balances: [] })), { amount: 0, units: 'usd' });
  assert.strictEqual(DeepgramSpeech.parseBalance('{}'), null);
  assert.strictEqual(DeepgramSpeech.parseBalance('nope'), null);
});

test('formatBalance shows two decimals and an upper-case unit', () => {
  assert.strictEqual(DeepgramSpeech.formatBalance({ amount: 199.98815556, units: 'usd' }), '199.99 USD');
  assert.strictEqual(DeepgramSpeech.formatBalance({ amount: 0, units: 'usd' }), '0.00 USD');
});
