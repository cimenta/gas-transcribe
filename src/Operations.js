const OperationsLogic = {
  MAX_AGE_MS: 24 * 3600 * 1000,

  nextAction(existing) {
    return existing && existing.state === 'running' ? 'reuse' : 'start';
  },

  // A synchronous provider (Groq) returns the finished text from start(); no operation is stored.
  isSynchronous(started) {
    return typeof (started && started.text) === 'string';
  },

  isStale(op, nowMs) {
    return nowMs - op.startedAt > OperationsLogic.MAX_AGE_MS;
  },
};

const OP_PREFIX = 'op:';

function readOp_(fileId) {
  const raw = Settings_get_(OP_PREFIX + fileId);
  return raw ? JSON.parse(raw) : null;
}

function writeOp_(op) {
  Settings_set_(OP_PREFIX + op.fileId, JSON.stringify(op));
}

function deleteOp_(fileId) {
  PropertiesService.getScriptProperties().deleteProperty(OP_PREFIX + fileId);
}

function errorCode_(error) {
  return (error && error.code) || 'generic';
}

function startTranscription_(fileId, overwrite) {
  if (!isUnderConnectedFolder_(fileId)) throw new Error('Forbidden');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const existing = readOp_(fileId);
    if (OperationsLogic.nextAction(existing) === 'reuse') return { state: 'running' };

    const file = DriveApp.getFileById(fileId);
    const settings = getSettings_();
    // Only this provider's own result counts; results of other providers are kept side by side.
    if (findResultFile_(file, 'txt', settings.provider) && !overwrite) return { state: 'error', code: 'transcriptExists' };

    const fileLanguage = Settings_get_(FILE_LANG_PREFIX + fileId);
    if (fileLanguage) settings.speechLanguage = fileLanguage;
    const provider = Providers.get(settings.provider);
    const info = { id: fileId, name: file.getName(), mimeType: file.getMimeType() };
    const base = { fileId, provider: settings.provider, startedAt: Date.now(), overwrite: Boolean(overwrite) };
    if (!provider.supports(info.name, info.mimeType)) {
      writeOp_(Object.assign(base, { state: 'error', code: 'unsupportedFormat' }));
      return { state: 'error', code: 'unsupportedFormat' };
    }
    try {
      const started = provider.start(info, settings);
      if (OperationsLogic.isSynchronous(started)) return finishSynchronous_(fileId, base, started);
      writeOp_(Object.assign(base, { state: 'running', opName: started.opName, cleanupRef: started.cleanupRef }));
      return { state: 'running' };
    } catch (e) {
      const code = errorCode_(e);
      const detail = errorDetail_(e);
      console.log('transcription start failed: ' + code + ' ' + detail);
      writeOp_(Object.assign(base, { state: 'error', code, detail }));
      return { state: 'error', code, detail };
    }
  } finally {
    lock.releaseLock();
  }
}

// The JSON result is an extra: if it cannot be written the text transcript still stands.
function saveTranscriptJson_(fileId, started, provider) {
  try {
    const file = DriveApp.getFileById(fileId);
    const content = Logic.buildTranscriptJson(fileId, provider, started.model, started.json, new Date().toISOString());
    const existing = findResultFile_(file, 'json', provider);
    if (existing) {
      existing.setContent(content);
      return;
    }
    const parents = file.getParents();
    if (parents.hasNext()) parents.next().createFile(Logic.transcriptJsonName(file.getName(), provider), content, 'application/json');
  } catch (e) {
    console.log('json save failed: ' + errorCode_(e));
  }
}

function finishSynchronous_(fileId, base, started) {
  const text = started.text;
  const fail = (code) => {
    writeOp_(Object.assign(base, { state: 'error', code }));
    return { state: 'error', code };
  };
  if (!text) return fail('noSpeech');
  try {
    saveTranscript_(fileId, text, base.provider);
  } catch (e) {
    return fail('transcriptWrite');
  }
  if (started.json) saveTranscriptJson_(fileId, started, base.provider);
  deleteOp_(fileId);
  return { state: 'done' };
}

function saveTranscript_(fileId, text, provider) {
  const file = DriveApp.getFileById(fileId);
  const content = Logic.buildTranscript(fileId, text);
  const existing = findResultFile_(file, 'txt', provider);
  if (existing) {
    existing.setContent(content);
    return;
  }
  const parents = file.getParents();
  if (!parents.hasNext()) throw new Error('no parent');
  parents.next().createFile(Logic.transcriptFileName(file.getName(), provider), content, MimeType.PLAIN_TEXT);
}

// Deletes the provider's temporary copy. A failure is logged (code only) and never stops the run;
// the bucket's lifecycle rule is the backstop for copies that could not be removed.
function safeCleanup_(provider, op, settings) {
  try {
    provider.cleanup(op, settings);
  } catch (e) {
    console.log('cleanup failed for ' + op.fileId + ': ' + errorCode_(e));
  }
}

function runningReport_(props) {
  return Object.keys(props)
    .filter((k) => k.indexOf(OP_PREFIX) === 0)
    .map((k) => JSON.parse(props[k]))
    .filter((op) => op.state === 'running')
    .map((op) => ({ fileId: op.fileId, state: 'running' }));
}

function finishOp_(op, provider, settings, result) {
  if (result.state === 'running') return { fileId: op.fileId, state: 'running' };
  if (result.state === 'done') {
    // Google bills the recognition whether or not the transcript can be saved afterwards.
    if (op.provider === 'google-speech' && result.billedSeconds) {
      try {
        recordUsage_(result.billedSeconds);
      } catch (e) {
        console.log('usage record failed: ' + errorCode_(e));
      }
    }
    let code = null;
    if (!isUnderConnectedFolder_(op.fileId)) code = 'forbidden';
    else {
      try {
        saveTranscript_(op.fileId, result.text, op.provider);
      } catch (e) {
        code = 'transcriptWrite';
      }
    }
    safeCleanup_(provider, op, settings);
    if (!code) {
      deleteOp_(op.fileId);
      return { fileId: op.fileId, state: 'done' };
    }
    writeOp_(Object.assign(op, { state: 'error', code }));
    return { fileId: op.fileId, state: 'error', code };
  }
  writeOp_(Object.assign(op, { state: 'error', code: result.code, detail: result.message }));
  safeCleanup_(provider, op, settings);
  return { fileId: op.fileId, state: 'error', code: result.code };
}

// Serialised with a script lock so two overlapping polls cannot save the same transcript twice.
// Failed operations are not reported here; api_listFiles shows them.
function pollOperations_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return runningReport_(PropertiesService.getScriptProperties().getProperties());
  try {
    const settings = getSettings_();
    const props = PropertiesService.getScriptProperties().getProperties();
    const report = [];
    Object.keys(props).filter((k) => k.indexOf(OP_PREFIX) === 0).forEach((key) => {
      const op = JSON.parse(props[key]);
      if (op.state === 'error') {
        if (OperationsLogic.isStale(op, Date.now())) deleteOp_(op.fileId);
        return;
      }
      try {
        const provider = Providers.get(op.provider);
        report.push(finishOp_(op, provider, settings, provider.check(op, settings)));
      } catch (e) {
        console.log('poll failed for ' + op.fileId + ': ' + errorCode_(e));
        report.push({ fileId: op.fileId, state: 'running' });
      }
    });
    return report;
  } finally {
    lock.releaseLock();
  }
}

// Called when a recording is deleted: drop its operation and the temporary bucket copy.
function discardOperation_(fileId) {
  const op = readOp_(fileId);
  if (!op) return;
  if (op.state === 'running') {
    try {
      safeCleanup_(Providers.get(op.provider), op, getSettings_());
    } catch (e) {
      console.log('discard failed for ' + fileId + ': ' + errorCode_(e));
    }
  }
  deleteOp_(fileId);
}

if (typeof module !== 'undefined') module.exports = OperationsLogic;
