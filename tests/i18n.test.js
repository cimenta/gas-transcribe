const test = require('node:test');
const assert = require('node:assert');
const I18n = require('../src/I18n.js');

test('cs and en define the same keys', () => {
  assert.deepStrictEqual(Object.keys(I18n.STRINGS.cs).sort(), Object.keys(I18n.STRINGS.en).sort());
});

test('no translation is empty', () => {
  ['cs', 'en'].forEach((lang) => {
    Object.entries(I18n.STRINGS[lang]).forEach(([key, value]) => {
      assert.ok(String(value).trim().length > 0, lang + ':' + key);
    });
  });
});

test('t substitutes params', () => {
  assert.ok(I18n.t('cs', 'confirm.delete', { name: 'a.opus' }).includes('a.opus'));
});

test('t returns the key for unknown keys', () => {
  assert.strictEqual(I18n.t('en', 'nope'), 'nope');
});

test('resolveLang prefers saved value, then browser language', () => {
  assert.strictEqual(I18n.resolveLang('en', 'cs-CZ'), 'en');
  assert.strictEqual(I18n.resolveLang(undefined, 'cs-CZ'), 'cs');
  assert.strictEqual(I18n.resolveLang(undefined, 'de'), 'en');
});

test('every operation error code has a translation', () => {
  ['noSpeech', 'unsupportedFormat', 'noBucket', 'bucketWrite', 'generic', 'transcriptExists', 'transcriptWrite',
    'noKey', 'invalidKey', 'tooLarge', 'rateLimit', 'badLanguage', 'noCredit']
    .forEach((code) => assert.ok(('error.' + code) in I18n.STRINGS.cs, code));
});

test('help chapters have a title and steps in both languages', () => {
  ['deploy', 'speech', 'groq', 'deepgram', 'privacy'].forEach((id) => {
    ['cs', 'en'].forEach((lang) => {
      assert.ok(I18n.STRINGS[lang]['helptab.' + id], lang + ' tab ' + id);
      assert.ok(I18n.STRINGS[lang]['help.' + id + '.title'], lang + ' title ' + id);
      assert.ok(I18n.STRINGS[lang]['help.' + id + '.steps'].split('\n').length >= 3, lang + ' steps ' + id);
    });
  });
});

test('the speech help covers every setup step including the bucket', () => {
  ['cs', 'en'].forEach((lang) => {
    const steps = I18n.STRINGS[lang]['help.speech.steps'];
    assert.ok(steps.includes('Cloud Speech-to-Text API'));
    assert.ok(steps.includes('Change project'));
    assert.ok(steps.includes('Lifecycle'));
    assert.ok(steps.includes('Enforce public access prevention on this bucket'));
  });
});

test('required keys exist', () => {
  const required = ['app.title', 'folders.add', 'toolbar.hideTranscribed', 'status.done',
    'action.transcribe', 'action.view', 'action.delete', 'confirm.delete', 'error.noSpeech',
    'settings.bucket', 'nav.help'];
  required.forEach((key) => assert.ok(key in I18n.STRINGS.cs, key));
});
