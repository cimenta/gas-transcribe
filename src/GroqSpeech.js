// Groq hosts Whisper behind an OpenAI-compatible endpoint. The request is synchronous: the transcript
// comes back in the same response, so there is no bucket, no long-running operation and nothing to poll.
const GroqSpeech = {
  ENDPOINT: 'https://api.groq.com/openai/v1/audio/transcriptions',
  EXTENSIONS: ['opus', 'ogg', 'mp3', 'flac', 'wav', 'm4a'],

  languageCode(speechLanguage) {
    return String(speechLanguage || '').split('-')[0].toLowerCase();
  },

  // Groq lists ogg but not opus; an .opus file is an Ogg container, so it is uploaded as .ogg.
  uploadName(fileName) {
    return String(fileName || '').replace(/\.opus$/i, '.ogg');
  },

  buildFields(model, speechLanguage) {
    return { model, language: GroqSpeech.languageCode(speechLanguage), response_format: 'verbose_json', temperature: '0' };
  },

  supports(fileName) {
    const ext = /\.([^.]+)$/.exec(fileName || '');
    return Boolean(ext) && GroqSpeech.EXTENSIONS.indexOf(ext[1].toLowerCase()) !== -1;
  },

  mapStatus(status) {
    if (status === 401 || status === 403) return 'invalidKey';
    if (status === 413) return 'tooLarge';
    if (status === 429) return 'rateLimit';
    return 'generic';
  },

  parseText(contentText) {
    const parsed = GroqSpeech.parseResponse(contentText);
    return parsed ? parsed.text : null;
  },

  // {text, response}: the trimmed transcript and the untouched response object (kept as the JSON result).
  parseResponse(contentText) {
    try {
      const response = JSON.parse(contentText);
      return response && typeof response.text === 'string' ? { text: response.text.trim(), response } : null;
    } catch (e) {
      return null;
    }
  },

  isValidKey(key) {
    return /^[A-Za-z0-9_-]{20,200}$/.test(String(key || ''));
  },
};

function groqProvider_() {
  return {
    id: 'groq',
    name: 'Groq (Whisper)',

    supports(fileName) {
      return GroqSpeech.supports(fileName);
    },

    // The API key is read here and never leaves the server (it is not part of getSettings_()).
    start(file, settings) {
      const key = Settings_get_('groqApiKey');
      if (!key) throw providerError_('noKey');
      if (!this.supports(file.name)) throw providerError_('unsupportedFormat');

      const blob = DriveApp.getFileById(file.id).getBlob();
      blob.setName(GroqSpeech.uploadName(file.name));
      const payload = Object.assign(GroqSpeech.buildFields(settings.groqModel, settings.speechLanguage), { file: blob });
      const response = UrlFetchApp.fetch(GroqSpeech.ENDPOINT, {
        method: 'post',
        headers: { Authorization: 'Bearer ' + key },
        payload,
        muteHttpExceptions: true,
      });
      const status = response.getResponseCode();
      if (status >= 300) {
        throw providerError_(GroqSpeech.mapStatus(status),
          'groq ' + status + ': ' + GoogleSpeech.apiErrorMessage(response.getContentText()));
      }
      const parsed = GroqSpeech.parseResponse(response.getContentText());
      if (parsed === null) throw providerError_('generic', 'groq: unexpected response');
      return { text: parsed.text, json: parsed.response, model: settings.groqModel };
    },

    // Never used: Groq finishes inside start(), so no running operation is ever stored.
    check() {
      return { state: 'error', code: 'generic', message: 'groq has no operations' };
    },

    cleanup() {},
  };
}

if (typeof module !== 'undefined') module.exports = GroqSpeech;
