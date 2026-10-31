const GoogleSpeech = {
  VALID_OPUS_RATES: [8000, 12000, 16000, 24000, 48000],

  buildRecognizeRequest(gcsUri, encoding, languageCode, extraConfig) {
    return {
      config: Object.assign({ encoding, languageCode, enableAutomaticPunctuation: true }, extraConfig),
      audio: { uri: gcsUri },
    };
  },

  // Reads channel count and input sample rate from the OpusHead packet (signed or unsigned bytes).
  opusInfo(bytes) {
    const limit = Math.min(bytes.length, 256);
    const magic = 'OpusHead';
    for (let i = 0; i + 16 <= limit; i++) {
      let match = true;
      for (let j = 0; j < magic.length && match; j++) {
        match = (bytes[i + j] & 0xff) === magic.charCodeAt(j);
      }
      if (!match) continue;
      const rate = ((bytes[i + 12] & 0xff) | ((bytes[i + 13] & 0xff) << 8) |
        ((bytes[i + 14] & 0xff) << 16) | ((bytes[i + 15] & 0xff) << 24)) >>> 0;
      return {
        channels: bytes[i + 9] & 0xff,
        sampleRate: GoogleSpeech.VALID_OPUS_RATES.indexOf(rate) !== -1 ? rate : 48000,
      };
    }
    return null;
  },

  extractTranscript(operation) {
    let results = (operation && operation.response && operation.response.results) || [];
    if (results.every((r) => r.resultEndTime !== undefined)) {
      results = results.slice().sort((a, b) => parseFloat(a.resultEndTime) - parseFloat(b.resultEndTime));
    }
    const parts = results
      .map((r) => (r.alternatives && r.alternatives[0] && r.alternatives[0].transcript) || '')
      .filter((t) => t.length > 0);
    return parts.length ? parts.join(' ') : null;
  },

  // Billed time (rounded up by Google, per channel) of a finished operation, e.g. "75s" -> 75.
  billedSecondsOf(operation) {
    const raw = operation && operation.response && operation.response.totalBilledTime;
    const match = /^(\d+(?:\.\d+)?)s$/.exec(String(raw || ''));
    return match ? parseFloat(match[1]) : 0;
  },

  // Message of a Google API error body (e.g. "API has not been used in project ..."), for diagnostics.
  apiErrorMessage(contentText) {
    try {
      const message = JSON.parse(contentText).error.message;
      return typeof message === 'string' ? message.slice(0, 500) : '';
    } catch (e) {
      return '';
    }
  },

  // cleanupRef is "<bucket>/<object name>" so the copy is deleted from the bucket it was uploaded to.
  parseCleanupRef(ref) {
    const slash = String(ref || '').indexOf('/');
    if (slash < 1) return null;
    return { bucket: ref.slice(0, slash), object: ref.slice(slash + 1) };
  },

  isTransientStatus(status) {
    return status === 429 || (status >= 500 && status < 600);
  },

  mapApiError(status) {
    if (status === 404) return 'noBucket';
    if (status === 401 || status === 403) return 'bucketWrite';
    return 'generic';
  },
};

function providerError_(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function googleFetch_(url, options) {
  const params = Object.assign({ muteHttpExceptions: true }, options);
  params.headers = Object.assign({ Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, params.headers);
  return UrlFetchApp.fetch(url, params);
}

function googleSpeechProvider_() {
  return {
    id: 'google-speech',
    name: 'Google Cloud Speech-to-Text',

    supports(fileName) {
      // MP3 is only a beta encoding in the Speech-to-Text docs, so it is not offered yet.
      const encoding = Logic.encodingFor(fileName);
      return encoding !== null && encoding !== 'MP3';
    },

    start(file, settings) {
      if (!settings.bucket) throw providerError_('noBucket');
      if (!this.supports(file.name)) throw providerError_('unsupportedFormat');
      const encoding = Logic.encodingFor(file.name);

      const blob = DriveApp.getFileById(file.id).getBlob();
      const extraConfig = {};
      if (settings.model && settings.model !== 'default') extraConfig.model = settings.model;
      const opus = encoding === 'OGG_OPUS' ? GoogleSpeech.opusInfo(blob.getBytes()) : null;
      if (opus) {
        extraConfig.sampleRateHertz = opus.sampleRate;
        if (opus.channels > 1) {
          extraConfig.audioChannelCount = opus.channels;
          extraConfig.enableSeparateRecognitionPerChannel = true;
        }
      }
      const objectName = 'gas-transcribe/' + file.id + '-' + Date.now();
      const upload = googleFetch_(
        'https://storage.googleapis.com/upload/storage/v1/b/' + encodeURIComponent(settings.bucket) +
          '/o?uploadType=media&name=' + encodeURIComponent(objectName),
        { method: 'post', contentType: blob.getContentType() || 'application/octet-stream', payload: blob.getBytes() });
      if (upload.getResponseCode() >= 300) {
        throw providerError_(GoogleSpeech.mapApiError(upload.getResponseCode()),
          'storage ' + upload.getResponseCode() + ': ' + GoogleSpeech.apiErrorMessage(upload.getContentText()));
      }

      const cleanupRef = settings.bucket + '/' + objectName;
      const body = GoogleSpeech.buildRecognizeRequest(
        'gs://' + cleanupRef, encoding, settings.speechLanguage, extraConfig);
      let response;
      try {
        response = googleFetch_('https://speech.googleapis.com/v1/speech:longrunningrecognize', {
          method: 'post', contentType: 'application/json', payload: JSON.stringify(body) });
      } catch (e) {
        this.cleanup({ cleanupRef }, settings);
        throw providerError_('generic', 'speech request failed');
      }
      if (response.getResponseCode() >= 300) {
        this.cleanup({ cleanupRef }, settings);
        throw providerError_('generic',
          'speech api ' + response.getResponseCode() + ': ' + GoogleSpeech.apiErrorMessage(response.getContentText()));
      }
      return { opName: JSON.parse(response.getContentText()).name, cleanupRef };
    },

    check(op) {
      const response = googleFetch_('https://speech.googleapis.com/v1/operations/' + encodeURIComponent(op.opName));
      const status = response.getResponseCode();
      if (GoogleSpeech.isTransientStatus(status)) return { state: 'running' };
      if (status >= 300) {
        return { state: 'error', code: 'generic',
          message: 'speech api ' + status + ': ' + GoogleSpeech.apiErrorMessage(response.getContentText()) };
      }
      const operation = JSON.parse(response.getContentText());
      if (!operation.done) return { state: 'running' };
      if (operation.error) return { state: 'error', code: 'generic', message: operation.error.message || 'error' };
      const text = GoogleSpeech.extractTranscript(operation);
      if (!text) return { state: 'error', code: 'noSpeech', message: 'no speech' };
      return { state: 'done', text, billedSeconds: GoogleSpeech.billedSecondsOf(operation) };
    },

    cleanup(op) {
      const ref = GoogleSpeech.parseCleanupRef(op.cleanupRef);
      if (!ref) return;
      const response = googleFetch_(
        'https://storage.googleapis.com/storage/v1/b/' + encodeURIComponent(ref.bucket) +
          '/o/' + encodeURIComponent(ref.object),
        { method: 'delete' });
      const status = response.getResponseCode();
      if (status >= 300 && status !== 404) throw providerError_(GoogleSpeech.mapApiError(status));
    },
  };
}

if (typeof module !== 'undefined') module.exports = GoogleSpeech;
