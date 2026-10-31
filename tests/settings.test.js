const test = require('node:test');
const assert = require('node:assert');
const Settings = require('../src/Settings.js');

test('parseLanguage accepts a language code, an empty value (use the default) and rejects junk', () => {
  assert.deepStrictEqual(Settings.parseLanguage(' cs-CZ '), { ok: true, value: 'cs-CZ' });
  assert.deepStrictEqual(Settings.parseLanguage('en'), { ok: true, value: 'en' });
  assert.deepStrictEqual(Settings.parseLanguage(''), { ok: true, value: '' });
  assert.deepStrictEqual(Settings.parseLanguage(undefined), { ok: true, value: '' });
  assert.strictEqual(Settings.parseLanguage('<x>').ok, false);
  assert.strictEqual(Settings.parseLanguage('czech language').ok, false);
});

test('parseFolderId accepts a bare id', () => {
  assert.strictEqual(Settings.parseFolderId('1AbC_-xyz'), '1AbC_-xyz');
});

test('parseFolderId extracts id from a link with query', () => {
  assert.strictEqual(
    Settings.parseFolderId('https://drive.google.com/drive/folders/1AbC_-xyz?usp=sharing'), '1AbC_-xyz');
});

test('parseFolderId extracts id from a /u/0/ link', () => {
  assert.strictEqual(
    Settings.parseFolderId('https://drive.google.com/drive/u/0/folders/1AbC_-xyz'), '1AbC_-xyz');
});

const valid = { provider: 'google-speech', bucket: 'my-bucket.1', speechLanguage: 'cs-CZ', uiLang: 'cs', freeMinutes: 60, model: 'latest_long',
  groqModel: 'whisper-large-v3', groqApiKey: '' };

test('validateSettings validates the Groq model and key', () => {
  const run = (extra) => Settings.validateSettings(Object.assign({}, valid, extra), ['google-speech', 'groq']);
  assert.strictEqual(run({ provider: 'groq', groqModel: 'whisper-large-v3-turbo' }).ok, true);
  assert.deepStrictEqual(run({ groqModel: 'gpt-4' }), { ok: false, field: 'groqModel' });
  assert.strictEqual(run({ groqApiKey: 'gsk_' + 'a'.repeat(40) }).value.groqApiKey, 'gsk_' + 'a'.repeat(40));
  assert.strictEqual(run({ groqApiKey: '  ' }).value.groqApiKey, '');
  assert.deepStrictEqual(run({ groqApiKey: 'bad key' }), { ok: false, field: 'groqApiKey' });
});

test('validateSettings defaults the Groq model when absent', () => {
  const input = Object.assign({}, valid);
  delete input.groqModel;
  assert.strictEqual(Settings.validateSettings(input, ['google-speech']).value.groqModel, 'whisper-large-v3');
});

test('validateSettings validates freeMinutes as a non-negative whole number', () => {
  const run = (freeMinutes) => Settings.validateSettings(Object.assign({}, valid, { freeMinutes }), ['google-speech']);
  assert.strictEqual(run(0).ok, true);
  assert.strictEqual(run('120').value.freeMinutes, 120);
  assert.deepStrictEqual(run(-1), { ok: false, field: 'freeMinutes' });
  assert.deepStrictEqual(run(1.5), { ok: false, field: 'freeMinutes' });
  assert.deepStrictEqual(run('abc'), { ok: false, field: 'freeMinutes' });
  assert.deepStrictEqual(run(''), { ok: false, field: 'freeMinutes' });
});

test('validateSettings accepts known models, defaults to latest_long and rejects others', () => {
  const run = (model) => Settings.validateSettings(Object.assign({}, valid, { model }), ['google-speech']);
  assert.strictEqual(run('default').value.model, 'default');
  assert.strictEqual(run('latest_long').value.model, 'latest_long');
  assert.strictEqual(run(undefined).value.model, 'latest_long');
  assert.deepStrictEqual(run('phone_call'), { ok: false, field: 'model' });
});

test('validateSettings defaults freeMinutes to 60 when absent', () => {
  const input = Object.assign({}, valid);
  delete input.freeMinutes;
  assert.strictEqual(Settings.validateSettings(input, ['google-speech']).value.freeMinutes, 60);
});

test('validateSettings accepts valid settings', () => {
  assert.deepStrictEqual(Settings.validateSettings(valid, ['google-speech']), { ok: true, value: valid });
});

test('validateSettings accepts an empty bucket and empty uiLang', () => {
  assert.strictEqual(Settings.validateSettings(Object.assign({}, valid, { bucket: '', uiLang: '' }), ['google-speech']).ok, true);
});

test('validateSettings rejects unknown provider, bad bucket, bad language', () => {
  assert.deepStrictEqual(Settings.validateSettings(Object.assign({}, valid, { provider: 'x' }), ['google-speech']), { ok: false, field: 'provider' });
  assert.deepStrictEqual(Settings.validateSettings(Object.assign({}, valid, { bucket: '../evil bucket' }), ['google-speech']), { ok: false, field: 'bucket' });
  assert.deepStrictEqual(Settings.validateSettings(Object.assign({}, valid, { speechLanguage: '<x>' }), ['google-speech']), { ok: false, field: 'speechLanguage' });
  assert.deepStrictEqual(Settings.validateSettings(Object.assign({}, valid, { uiLang: 'de' }), ['google-speech']), { ok: false, field: 'uiLang' });
});

test('parseFolderId rejects blank and invalid input', () => {
  assert.strictEqual(Settings.parseFolderId('  '), null);
  assert.strictEqual(Settings.parseFolderId('neco s mezerou'), null);
});
