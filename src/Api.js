// Functions called from the browser through google.script.run. Each one checks the caller
// first and returns {error: {code, message}} instead of throwing, so no server details leak.

function guard_(fn) {
  try {
    assertOwner_();
    return fn();
  } catch (e) {
    const code = e.message === 'Forbidden' ? 'forbidden' : (e.code || 'generic');
    console.log('api error: ' + code);
    const lang = I18n.resolveLang(Settings_get_('uiLang'), '');
    return { error: { code, message: I18n.t(lang, 'error.' + code) } };
  }
}

function formatDate_(ms) {
  return Utilities.formatDate(new Date(ms), Session.getScriptTimeZone(), 'd. M. yyyy HH:mm');
}

function api_getBootstrap(browserLang) {
  return guard_(() => {
    const settings = getSettings_();
    const lang = I18n.resolveLang(settings.uiLang, browserLang);
    return { lang, strings: I18n.STRINGS, settings, providers: Providers.list(), version: APP_VERSION };
  });
}

function api_getFolders() {
  return guard_(() => getFolderIds_().map((id) => {
    try {
      return { id, name: DriveApp.getFolderById(id).getName() };
    } catch (e) {
      return { id, name: id, unavailable: true };
    }
  }));
}

function api_addFolder(idOrUrl) {
  return guard_(() => addFolder_(String(idOrUrl)));
}

function api_removeFolder(id) {
  return guard_(() => {
    removeFolder_(String(id));
    return true;
  });
}

function api_listFiles() {
  return guard_(() => {
    // Once: results written before 0.2.1 get the provider in their file name (retried while a folder is unreadable).
    if (Settings_get_('migratedResults') !== '1' && migrateLegacyResults_()) Settings_set_('migratedResults', '1');
    const scan = listAudioFiles_();
    const provider = getSettings_().provider;
    const props = PropertiesService.getScriptProperties().getProperties();
    const items = scan.items.map((file) => {
      const texts = (scan.transcripts[file.id] || []).map((r) => r.text);
      const raw = props[OP_PREFIX + file.id];
      const op = raw ? JSON.parse(raw) : null;
      let status = 'none';
      let code;
      if (op && op.state === 'running') status = 'running';
      else if (DriveLogic.hasResult(file.results, provider)) status = 'done';
      else if (op && op.state === 'error') {
        status = 'error';
        code = op.code;
      }
      return {
        id: file.id,
        name: file.name,
        folderPath: file.folderPath,
        modified: file.modified,
        modifiedText: formatDate_(file.modified),
        status,
        results: file.results,
        language: props[FILE_LANG_PREFIX + file.id] || '',
        errorCode: code,
        errorDetail: status === 'error' && op ? op.detail : undefined,
        transcriptText: texts.length ? texts.join(String.fromCharCode(10)) : undefined,
      };
    });
    const lang = I18n.resolveLang(Settings_get_('uiLang'), '');
    const errors = scan.errors.map((e) => ({ folderId: e.folderId, message: I18n.t(lang, 'error.folderUnavailable') + (e.detail ? ' (' + e.detail + ')' : '') }));
    return { items, errors };
  });
}

// Up to 5 files per call; a file whose length cannot be read maps to null.
function api_getDurations(fileIds) {
  return guard_(() => {
    const result = {};
    (Array.isArray(fileIds) ? fileIds : []).slice(0, 5).forEach((raw) => {
      const id = String(raw);
      result[id] = null;
      try {
        if (isUnderConnectedFolder_(id)) result[id] = estimateDuration_(id);
      } catch (e) {
        console.log('duration failed: ' + errorDetail_(e));
      }
    });
    return result;
  });
}

// Language of one recording ("" = use the default from Settings), used by the next transcription.
function api_setFileLanguage(fileId, language) {
  return guard_(() => {
    if (!isUnderConnectedFolder_(String(fileId))) throw new Error('Forbidden');
    const parsed = Settings.parseLanguage(language);
    if (!parsed.ok) {
      const error = new Error('invalid language');
      error.code = 'badLanguage';
      throw error;
    }
    setFileLanguage_(String(fileId), parsed.value);
    return parsed.value;
  });
}

function api_transcribe(fileId, overwrite) {
  return guard_(() => startTranscription_(String(fileId), Boolean(overwrite)));
}

function api_pollOperations() {
  return guard_(() => pollOperations_());
}

// A provider id from the browser: '' (a result from before per-provider files) or one of the known providers.
function providerArg_(provider) {
  const value = String(provider === undefined || provider === null ? '' : provider);
  if (value !== '' && !Providers.list().some((p) => p.id === value)) throw new Error('invalid provider');
  return value;
}

function api_getTranscript(fileId, provider) {
  return guard_(() => {
    if (!isUnderConnectedFolder_(String(fileId))) throw new Error('Forbidden');
    const transcript = findResultFile_(DriveApp.getFileById(String(fileId)), 'txt', providerArg_(provider));
    if (!transcript) return '';
    const parsed = Logic.parseTranscript(transcript.getBlob().getDataAsString());
    return parsed ? parsed.text : '';
  });
}

// The saved JSON result (provider response with timed segments), as stored on the Drive.
function api_getTranscriptJson(fileId, provider) {
  return guard_(() => {
    if (!isUnderConnectedFolder_(String(fileId))) throw new Error('Forbidden');
    const jsonFile = findResultFile_(DriveApp.getFileById(String(fileId)), 'json', providerArg_(provider));
    return jsonFile ? jsonFile.getBlob().getDataAsString() : '';
  });
}

// The recording itself for the in-page player (base64, so only small files); a larger one is opened in Drive.
const MAX_PLAY_BYTES = 10 * 1024 * 1024;

function api_getAudio(fileId) {
  return guard_(() => {
    if (!isUnderConnectedFolder_(String(fileId))) throw new Error('Forbidden');
    const file = DriveApp.getFileById(String(fileId));
    if (file.getSize() > MAX_PLAY_BYTES) return { tooLarge: true, url: file.getUrl() };
    return {
      mime: Logic.audioMime(file.getName()) || file.getMimeType(),
      data: Utilities.base64Encode(file.getBlob().getBytes()),
      url: file.getUrl(),
    };
  });
}

function api_deleteFile(fileId) {
  return guard_(() => {
    trashFileAndResults_(String(fileId));
    discardOperation_(String(fileId));
    setFileLanguage_(String(fileId), '');
    return true;
  });
}

function api_saveSettings(input) {
  return guard_(() => {
    const ids = Providers.list().map((p) => p.id);
    const result = Settings.validateSettings(input, ids);
    if (!result.ok) {
      const error = new Error('invalid ' + result.field);
      error.code = 'generic';
      throw error;
    }
    const v = result.value;
    Settings_set_('provider', v.provider);
    Settings_set_('bucket', v.bucket);
    Settings_set_('speechLanguage', v.speechLanguage);
    Settings_set_('uiLang', v.uiLang);
    Settings_set_('freeMinutes', String(v.freeMinutes));
    Settings_set_('model', v.model);
    Settings_set_('groqModel', v.groqModel);
    if (v.groqApiKey) Settings_set_('groqApiKey', v.groqApiKey);
    Settings_set_('deepgramModel', v.deepgramModel);
    if (v.deepgramApiKey) Settings_set_('deepgramApiKey', v.deepgramApiKey);
    if (v.deepgramBillingKey) Settings_set_('deepgramBillingKey', v.deepgramBillingKey);
    return true;
  });
}

// Remaining Deepgram credit: null without a billing key, else {balance} or {error}.
function api_getDeepgramBalance() {
  return guard_(() => deepgramBalance_());
}

function api_getUsage() {
  return guard_(() => getUsageSummary_());
}
