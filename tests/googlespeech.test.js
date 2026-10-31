const test = require('node:test');
const assert = require('node:assert');
const GoogleSpeech = require('../src/GoogleSpeech.js');

test('buildRecognizeRequest builds a long-running request for a gcs uri', () => {
  assert.deepStrictEqual(GoogleSpeech.buildRecognizeRequest('gs://b/o', 'OGG_OPUS', 'cs-CZ'), {
    config: { encoding: 'OGG_OPUS', languageCode: 'cs-CZ', enableAutomaticPunctuation: true },
    audio: { uri: 'gs://b/o' },
  });
});

test('extractTranscript joins the best alternative of every result', () => {
  const response = { response: { results: [
    { alternatives: [{ transcript: 'Ahoj' }] },
    { alternatives: [{ transcript: 'světe' }] },
  ] } };
  assert.strictEqual(GoogleSpeech.extractTranscript(response), 'Ahoj světe');
});

test('extractTranscript returns null when there are no results', () => {
  assert.strictEqual(GoogleSpeech.extractTranscript({ response: {} }), null);
});

test('billedSecondsOf reads totalBilledTime from a finished operation', () => {
  assert.strictEqual(GoogleSpeech.billedSecondsOf({ response: { totalBilledTime: '75s' } }), 75);
  assert.strictEqual(GoogleSpeech.billedSecondsOf({ response: { totalBilledTime: '12.5s' } }), 12.5);
});

test('billedSecondsOf returns 0 when the duration is missing or malformed', () => {
  assert.strictEqual(GoogleSpeech.billedSecondsOf({ response: {} }), 0);
  assert.strictEqual(GoogleSpeech.billedSecondsOf({ response: { totalBilledTime: 'abc' } }), 0);
  assert.strictEqual(GoogleSpeech.billedSecondsOf(null), 0);
});

test('apiErrorMessage extracts the message of a Google error body', () => {
  const body = JSON.stringify({ error: { code: 403, message: 'Cloud Speech-to-Text API has not been used in project 1 before.' } });
  assert.strictEqual(GoogleSpeech.apiErrorMessage(body), 'Cloud Speech-to-Text API has not been used in project 1 before.');
});

test('apiErrorMessage is empty for non-json or unexpected bodies and is length-limited', () => {
  assert.strictEqual(GoogleSpeech.apiErrorMessage('<html>'), '');
  assert.strictEqual(GoogleSpeech.apiErrorMessage('{}'), '');
  assert.strictEqual(GoogleSpeech.apiErrorMessage(JSON.stringify({ error: { message: 'x'.repeat(800) } })).length, 500);
});

function opusHead(channels, rate) {
  const bytes = new Array(60).fill(0);
  Array.from('OpusHead').forEach((c, i) => { bytes[20 + i] = c.charCodeAt(0); });
  bytes[28] = 1;
  bytes[29] = channels;
  bytes[32] = rate & 0xff;
  bytes[33] = (rate >> 8) & 0xff;
  bytes[34] = (rate >> 16) & 0xff;
  bytes[35] = (rate >> 24) & 0xff;
  return bytes;
}

test('opusInfo reads channels and sample rate from the OpusHead header', () => {
  assert.deepStrictEqual(GoogleSpeech.opusInfo(opusHead(2, 8000)), { channels: 2, sampleRate: 8000 });
});

test('opusInfo falls back to 48000 for sample rates the API does not accept', () => {
  assert.strictEqual(GoogleSpeech.opusInfo(opusHead(1, 44100)).sampleRate, 48000);
});

test('opusInfo returns null without an OpusHead header', () => {
  assert.strictEqual(GoogleSpeech.opusInfo([1, 2, 3]), null);
});

test('buildRecognizeRequest merges extra config for multichannel audio', () => {
  const request = GoogleSpeech.buildRecognizeRequest('gs://b/o', 'OGG_OPUS', 'cs-CZ',
    { sampleRateHertz: 8000, audioChannelCount: 2, enableSeparateRecognitionPerChannel: true });
  assert.strictEqual(request.config.audioChannelCount, 2);
  assert.strictEqual(request.config.sampleRateHertz, 8000);
  assert.strictEqual(request.config.enableSeparateRecognitionPerChannel, true);
});

test('extractTranscript orders multichannel results by end time', () => {
  const response = { response: { results: [
    { resultEndTime: '9.5s', alternatives: [{ transcript: 'druhá' }] },
    { resultEndTime: '2.0s', alternatives: [{ transcript: 'první' }] },
  ] } };
  assert.strictEqual(GoogleSpeech.extractTranscript(response), 'první druhá');
});

test('parseCleanupRef splits bucket and object name', () => {
  assert.deepStrictEqual(GoogleSpeech.parseCleanupRef('my-bucket/gas-transcribe/abc-1'),
    { bucket: 'my-bucket', object: 'gas-transcribe/abc-1' });
  assert.strictEqual(GoogleSpeech.parseCleanupRef('nonsense'), null);
});

test('isTransientStatus treats rate limits and server errors as retryable', () => {
  [429, 500, 502, 503, 504].forEach((s) => assert.strictEqual(GoogleSpeech.isTransientStatus(s), true));
  [200, 403, 404].forEach((s) => assert.strictEqual(GoogleSpeech.isTransientStatus(s), false));
});

test('mapApiError maps http statuses to error codes', () => {
  assert.strictEqual(GoogleSpeech.mapApiError(404), 'noBucket');
  assert.strictEqual(GoogleSpeech.mapApiError(403), 'bucketWrite');
  assert.strictEqual(GoogleSpeech.mapApiError(500), 'generic');
});
