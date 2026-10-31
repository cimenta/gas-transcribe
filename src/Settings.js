const Settings = {
  // Speech-to-Text v1 models listed for Czech; there is no telephony model for cs-CZ.
  MODELS: ['latest_long', 'default'],
  GROQ_MODELS: ['whisper-large-v3', 'whisper-large-v3-turbo'],

  parseFolderId(input) {
    const text = String(input || '').trim();
    if (!text) return null;
    const fromLink = /\/folders\/([A-Za-z0-9_-]+)/.exec(text);
    if (fromLink) return fromLink[1];
    return /^[A-Za-z0-9_-]+$/.test(text) ? text : null;
  },

  // A per-file language override; an empty value means "use the default language from Settings".
  parseLanguage(input) {
    const value = String(input === undefined || input === null ? '' : input).trim();
    if (value === '') return { ok: true, value: '' };
    return /^[a-z]{2,3}(-[A-Za-z0-9]{2,4})?$/.test(value) ? { ok: true, value } : { ok: false };
  },

  validateSettings(input, providerIds) {
    const s = input || {};
    if (providerIds.indexOf(s.provider) === -1) return { ok: false, field: 'provider' };
    if (s.bucket !== '' && !/^[a-z0-9][a-z0-9._-]{1,220}$/.test(s.bucket || '')) return { ok: false, field: 'bucket' };
    if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,4})?$/.test(s.speechLanguage || '')) return { ok: false, field: 'speechLanguage' };
    if (['cs', 'en', ''].indexOf(s.uiLang) === -1) return { ok: false, field: 'uiLang' };
    const model = s.model === undefined ? 'latest_long' : s.model;
    if (Settings.MODELS.indexOf(model) === -1) return { ok: false, field: 'model' };
    const groqModel = s.groqModel === undefined ? 'whisper-large-v3' : s.groqModel;
    if (Settings.GROQ_MODELS.indexOf(groqModel) === -1) return { ok: false, field: 'groqModel' };
    // An empty key means "keep the stored one"; the key is never sent back to the browser.
    const groqApiKey = String(s.groqApiKey || '').trim();
    if (groqApiKey !== '' && !/^[A-Za-z0-9_-]{20,200}$/.test(groqApiKey)) return { ok: false, field: 'groqApiKey' };
    const rawFree = s.freeMinutes === undefined ? 60 : s.freeMinutes;
    const freeMinutes = typeof rawFree === 'string' && rawFree.trim() === '' ? NaN : Number(rawFree);
    if (!Number.isInteger(freeMinutes) || freeMinutes < 0 || freeMinutes > 100000) return { ok: false, field: 'freeMinutes' };
    return {
      ok: true,
      value: { provider: s.provider, bucket: s.bucket, speechLanguage: s.speechLanguage, uiLang: s.uiLang, freeMinutes, model, groqModel, groqApiKey },
    };
  },
};

function Settings_get_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function Settings_set_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
}

const FILE_LANG_PREFIX = 'fileLang:';

// Per-file language override (empty = the default language from Settings).
function setFileLanguage_(fileId, language) {
  if (language) Settings_set_(FILE_LANG_PREFIX + fileId, language);
  else PropertiesService.getScriptProperties().deleteProperty(FILE_LANG_PREFIX + fileId);
}

function getFolderIds_() {
  const raw = Settings_get_('folders');
  return raw ? JSON.parse(raw) : [];
}

function addFolder_(idOrUrl) {
  const id = Settings.parseFolderId(idOrUrl);
  if (!id) throw new Error('Invalid folder id');
  const folder = DriveApp.getFolderById(id);
  const ids = getFolderIds_();
  if (ids.indexOf(id) === -1) {
    ids.push(id);
    Settings_set_('folders', JSON.stringify(ids));
  }
  return { id, name: folder.getName() };
}

function removeFolder_(id) {
  Settings_set_('folders', JSON.stringify(getFolderIds_().filter((f) => f !== id)));
}

function getSettings_() {
  return {
    provider: Settings_get_('provider') || 'google-speech',
    bucket: Settings_get_('bucket') || '',
    speechLanguage: Settings_get_('speechLanguage') || 'cs-CZ',
    uiLang: Settings_get_('uiLang') || null,
    freeMinutes: Settings_get_('freeMinutes') === null ? 60 : Number(Settings_get_('freeMinutes')),
    model: Settings_get_('model') || 'latest_long',
    groqModel: Settings_get_('groqModel') || 'whisper-large-v3',
    groqKeySet: Boolean(Settings_get_('groqApiKey')),
  };
}

if (typeof module !== 'undefined') module.exports = Settings;
