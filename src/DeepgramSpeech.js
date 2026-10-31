// Deepgram pre-recorded transcription. Like Groq the request is synchronous: the audio bytes go in the
// request body and the transcript comes back in the same response, so there is no bucket and no polling.
const DeepgramSpeech = {
  ENDPOINT: 'https://api.deepgram.com/v1/listen',
  EXTENSIONS: ['opus', 'ogg', 'mp3', 'flac', 'wav', 'm4a', 'aac'],
  // UrlFetchApp refuses request bodies over 50 MB.
  MAX_BYTES: 50 * 1024 * 1024,

  languageCode(speechLanguage) {
    return String(speechLanguage || '').split('-')[0].toLowerCase();
  },

  // mip_opt_out keeps the audio out of Deepgram's Model Improvement Program (their training data).
  buildQuery(model, speechLanguage) {
    return 'model=' + model + '&language=' + DeepgramSpeech.languageCode(speechLanguage)
      + '&smart_format=true&punctuate=true&utterances=true&mip_opt_out=true';
  },

  extensionOf(fileName) {
    const ext = /\.([^.]+)$/.exec(fileName || '');
    return ext ? ext[1].toLowerCase() : '';
  },

  contentType(fileName) {
    switch (DeepgramSpeech.extensionOf(fileName)) {
      case 'opus':
      case 'ogg':
        return 'audio/ogg';
      case 'mp3':
        return 'audio/mpeg';
      case 'flac':
        return 'audio/flac';
      case 'wav':
        return 'audio/wav';
      case 'm4a':
        return 'audio/mp4';
      case 'aac':
        return 'audio/aac';
      default:
        return 'application/octet-stream';
    }
  },

  supports(fileName) {
    return DeepgramSpeech.EXTENSIONS.indexOf(DeepgramSpeech.extensionOf(fileName)) !== -1;
  },

  exceedsLimit(bytes) {
    return bytes > DeepgramSpeech.MAX_BYTES;
  },

  mapStatus(status) {
    if (status === 401 || status === 403) return 'invalidKey';
    if (status === 402) return 'noCredit';
    if (status === 413) return 'tooLarge';
    if (status === 429) return 'rateLimit';
    return 'generic';
  },

  // Deepgram errors look like {"err_code": "...", "err_msg": "...", "request_id": "..."}.
  errorMessage(contentText) {
    try {
      const message = JSON.parse(contentText).err_msg;
      return typeof message === 'string' ? message.slice(0, 500) : '';
    } catch (e) {
      return '';
    }
  },

  // {text, response}: the trimmed transcript and the untouched response object (kept as the JSON result).
  parseResponse(contentText) {
    try {
      const response = JSON.parse(contentText);
      const channels = response && response.results && response.results.channels;
      const alternative = Array.isArray(channels) && channels[0] && channels[0].alternatives && channels[0].alternatives[0];
      return alternative && typeof alternative.transcript === 'string' ? { text: alternative.transcript.trim(), response } : null;
    } catch (e) {
      return null;
    }
  },

  isValidKey(key) {
    return /^[A-Za-z0-9_-]{20,200}$/.test(String(key || ''));
  },

  // Management API (needs a key with the billing:read scope): the id of the account's first project.
  parseProjectId(contentText) {
    try {
      const project = JSON.parse(contentText).projects[0];
      return project && typeof project.project_id === 'string' ? project.project_id : null;
    } catch (e) {
      return null;
    }
  },

  // {amount, units}: the balances in the unit of the first one added up (rounded against float noise).
  parseBalance(contentText) {
    try {
      const balances = JSON.parse(contentText).balances;
      if (!Array.isArray(balances)) return null;
      if (!balances.length) return { amount: 0, units: 'usd' };
      const units = balances[0].units;
      const sum = balances.filter((b) => b.units === units).reduce((total, b) => total + Number(b.amount || 0), 0);
      return { amount: Math.round(sum * 1e8) / 1e8, units };
    } catch (e) {
      return null;
    }
  },

  formatBalance(balance) {
    return balance.amount.toFixed(2) + ' ' + String(balance.units).toUpperCase();
  },
};

// Remaining credit, read with the optional billing key. Returns {balance} or {error}; never throws, because
// a missing scope or a network problem must not break the file list.
function deepgramBalance_() {
  const key = Settings_get_('deepgramBillingKey');
  if (!key) return null;
  const get = (path) => UrlFetchApp.fetch('https://api.deepgram.com/v1' + path, {
    headers: { Authorization: 'Token ' + key }, muteHttpExceptions: true,
  });
  try {
    const projects = get('/projects');
    if (projects.getResponseCode() !== 200) return { error: projects.getResponseCode() === 403 ? 'noPermission' : 'failed' };
    const projectId = DeepgramSpeech.parseProjectId(projects.getContentText());
    if (!projectId) return { error: 'failed' };
    const balances = get('/projects/' + encodeURIComponent(projectId) + '/balances');
    if (balances.getResponseCode() !== 200) return { error: balances.getResponseCode() === 403 ? 'noPermission' : 'failed' };
    const balance = DeepgramSpeech.parseBalance(balances.getContentText());
    return balance ? { balance: DeepgramSpeech.formatBalance(balance) } : { error: 'failed' };
  } catch (e) {
    console.log('deepgram balance failed');
    return { error: 'failed' };
  }
}

function deepgramProvider_() {
  return {
    id: 'deepgram',
    name: 'Deepgram',

    supports(fileName) {
      return DeepgramSpeech.supports(fileName);
    },

    // The API key is read here and never leaves the server (it is not part of getSettings_()).
    start(file, settings) {
      const key = Settings_get_('deepgramApiKey');
      if (!key) throw providerError_('noKey');
      if (!this.supports(file.name)) throw providerError_('unsupportedFormat');

      const driveFile = DriveApp.getFileById(file.id);
      if (DeepgramSpeech.exceedsLimit(driveFile.getSize())) throw providerError_('tooLarge');
      const response = UrlFetchApp.fetch(DeepgramSpeech.ENDPOINT + '?' + DeepgramSpeech.buildQuery(settings.deepgramModel, settings.speechLanguage), {
        method: 'post',
        headers: { Authorization: 'Token ' + key },
        contentType: DeepgramSpeech.contentType(file.name),
        payload: driveFile.getBlob().getBytes(),
        muteHttpExceptions: true,
      });
      const status = response.getResponseCode();
      if (status >= 300) {
        throw providerError_(DeepgramSpeech.mapStatus(status),
          'deepgram ' + status + ': ' + DeepgramSpeech.errorMessage(response.getContentText()));
      }
      const parsed = DeepgramSpeech.parseResponse(response.getContentText());
      if (parsed === null) throw providerError_('generic', 'deepgram: unexpected response');
      return { text: parsed.text, json: parsed.response, model: settings.deepgramModel };
    },

    // Never used: Deepgram finishes inside start(), so no running operation is ever stored.
    check() {
      return { state: 'error', code: 'generic', message: 'deepgram has no operations' };
    },

    cleanup() {},
  };
}

if (typeof module !== 'undefined') module.exports = DeepgramSpeech;
