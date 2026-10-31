const test = require('node:test');
const assert = require('node:assert');
const AudioDuration = require('../src/AudioDuration.js');

function put(bytes, offset, value, length) {
  for (let i = 0; i < length; i++) bytes[offset + i] = Math.floor(value / Math.pow(2, 8 * i)) & 0xff;
}

function opusHead(channels, preSkip) {
  const bytes = new Array(40).fill(0);
  Array.from('OpusHead').forEach((c, i) => { bytes[i] = c.charCodeAt(0); });
  bytes[8] = 1;
  bytes[9] = channels;
  put(bytes, 10, preSkip, 2);
  put(bytes, 12, 8000, 4);
  return bytes;
}

function oggPage(granule) {
  const bytes = new Array(40).fill(0);
  Array.from('OggS').forEach((c, i) => { bytes[i] = c.charCodeAt(0); });
  put(bytes, 6, granule, 8);
  return bytes;
}

test('opus duration is (last granule - pre-skip) / 48000', () => {
  const head = opusHead(2, 312);
  const tail = [9, 9, 9].concat(oggPage(48000 * 60 + 312));
  assert.deepStrictEqual(AudioDuration.opus(head, tail), { durationSeconds: 60, channels: 2 });
});

test('opus uses the last Ogg page of the tail', () => {
  const tail = oggPage(1000).concat([7, 7], oggPage(48000 * 10));
  assert.strictEqual(AudioDuration.opus(opusHead(1, 0), tail).durationSeconds, 10);
});

test('opus returns null for a missing header, missing page or unknown granule', () => {
  assert.strictEqual(AudioDuration.opus([1, 2, 3], oggPage(48000)), null);
  assert.strictEqual(AudioDuration.opus(opusHead(1, 0), [1, 2, 3]), null);
  const unknown = oggPage(0);
  for (let i = 6; i < 14; i++) unknown[i] = 0xff;
  assert.strictEqual(AudioDuration.opus(opusHead(1, 0), unknown), null);
});

function wavHeader(channels, byteRate, dataSize) {
  const bytes = new Array(44).fill(0);
  Array.from('RIFF').forEach((c, i) => { bytes[i] = c.charCodeAt(0); });
  Array.from('WAVE').forEach((c, i) => { bytes[8 + i] = c.charCodeAt(0); });
  Array.from('fmt ').forEach((c, i) => { bytes[12 + i] = c.charCodeAt(0); });
  put(bytes, 16, 16, 4);
  put(bytes, 20, 1, 2);
  put(bytes, 22, channels, 2);
  put(bytes, 24, byteRate / (2 * channels), 4);
  put(bytes, 28, byteRate, 4);
  Array.from('data').forEach((c, i) => { bytes[36 + i] = c.charCodeAt(0); });
  put(bytes, 40, dataSize, 4);
  return bytes;
}

test('wav duration is data size / byte rate', () => {
  assert.deepStrictEqual(AudioDuration.wav(wavHeader(1, 32000, 320000), 320044), { durationSeconds: 10, channels: 1 });
});

test('wav with an unknown data size falls back to the file size', () => {
  assert.strictEqual(AudioDuration.wav(wavHeader(2, 64000, 0xffffffff), 640044).durationSeconds, 10);
});

test('wav returns null for non-wav data', () => {
  assert.strictEqual(AudioDuration.wav([1, 2, 3, 4], 100), null);
});

function flacHeader(sampleRate, channels, totalSamples) {
  const bytes = new Array(42).fill(0);
  Array.from('fLaC').forEach((c, i) => { bytes[i] = c.charCodeAt(0); });
  bytes[4] = 0x80;
  bytes[7] = 34;
  bytes[18] = (sampleRate >> 12) & 0xff;
  bytes[19] = (sampleRate >> 4) & 0xff;
  bytes[20] = ((sampleRate & 0xf) << 4) | ((channels - 1) << 1);
  bytes[21] = Math.floor(totalSamples / Math.pow(2, 32)) & 0x0f;
  put(bytes, 22, totalSamples % Math.pow(2, 32), 4);
  bytes[22] = (totalSamples >>> 24) & 0xff;
  bytes[23] = (totalSamples >>> 16) & 0xff;
  bytes[24] = (totalSamples >>> 8) & 0xff;
  bytes[25] = totalSamples & 0xff;
  return bytes;
}

test('flac duration is total samples / sample rate', () => {
  assert.deepStrictEqual(AudioDuration.flac(flacHeader(44100, 2, 44100 * 30)), { durationSeconds: 30, channels: 2 });
});

test('flac with unknown total samples returns null', () => {
  assert.strictEqual(AudioDuration.flac(flacHeader(44100, 2, 0)), null);
});

test('billedEstimate rounds up to 15 s per channel', () => {
  assert.strictEqual(AudioDuration.billedEstimate(61, 1), 75);
  assert.strictEqual(AudioDuration.billedEstimate(61, 2), 150);
  assert.strictEqual(AudioDuration.billedEstimate(1, 1), 15);
});

test('estimate dispatches by file name and bills opus stereo per channel', () => {
  const head = opusHead(2, 0);
  const tail = oggPage(48000 * 61);
  assert.deepStrictEqual(AudioDuration.estimate('call.opus', head, tail, 1000),
    { durationSeconds: 61, billedSeconds: 150 });
  assert.deepStrictEqual(AudioDuration.estimate('a.wav', wavHeader(2, 64000, 640000), [], 640044),
    { durationSeconds: 10, billedSeconds: 15 });
  assert.strictEqual(AudioDuration.estimate('a.mp3', head, tail, 1000), null);
  assert.strictEqual(AudioDuration.estimate('a.txt', head, tail, 1000), null);
});
