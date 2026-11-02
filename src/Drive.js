const DriveLogic = {
  AUDIO_EXTENSIONS: ['opus', 'ogg', 'mp3', 'flac', 'wav', 'm4a'],

  isAudio(mimeType, fileName) {
    if (/^audio\//.test(mimeType || '')) return true;
    const ext = /\.([^.]+)$/.exec(fileName || '');
    return Boolean(ext) && DriveLogic.AUDIO_EXTENSIONS.indexOf(ext[1].toLowerCase()) !== -1;
  },

  // <audio>.transcript.<provider>.txt|json; the provider part is missing in the legacy names.
  resultInfo(fileName) {
    const match = /\.transcript(?:\.([a-z][a-z0-9-]*))?\.(txt|json)$/.exec(fileName || '');
    return match ? { kind: match[2], provider: match[1] || '' } : null;
  },

  isTranscriptName(fileName) {
    const info = DriveLogic.resultInfo(fileName);
    return Boolean(info) && info.kind === 'txt';
  },

  isTranscriptJsonName(fileName) {
    const info = DriveLogic.resultInfo(fileName);
    return Boolean(info) && info.kind === 'json';
  },

  // [{provider, hasJson}] for the providers that have a result for this audio file, sorted by provider id.
  resultsFor(audioName, folderId, entries, jsonNames) {
    const naming = typeof Logic !== 'undefined' ? Logic : require('./Logic.js');
    return (entries || [])
      .map((e) => ({ provider: e.provider, hasJson: Boolean(jsonNames[folderId + '/' + naming.transcriptJsonName(audioName, e.provider)]) }))
      .sort((a, b) => a.provider.localeCompare(b.provider));
  },

  // Renames for results written before they were stored per provider (<audio>.transcript.txt / .json).
  // A legacy text takes the provider recorded in the legacy JSON of the same audio file; without a JSON it can
  // only have come from Google Speech, the one provider that does not write one. `taken` is a set of
  // "<folderId>/<name>" for the names already in use, so nothing is overwritten.
  planMigration(entries, taken) {
    const jsonProvider = {};
    entries.forEach((e) => { if (e.kind === 'json' && e.provider) jsonProvider[e.folderId + '/' + e.audioFileId] = e.provider; });
    const used = Object.assign({}, taken);
    const renames = [];
    entries.forEach((e) => {
      const info = DriveLogic.resultInfo(e.name);
      if (!info || info.provider !== '') return;
      const provider = jsonProvider[e.folderId + '/' + e.audioFileId] || (e.kind === 'json' ? e.provider : 'google-speech');
      if (!provider) return;
      const newName = e.name.replace(/\.transcript\.(txt|json)$/, '.transcript.' + provider + '.$1');
      if (used[e.folderId + '/' + newName]) return;
      used[e.folderId + '/' + newName] = true;
      renames.push({ id: e.id, newName });
    });
    return renames;
  },

  hasResult(results, provider) {
    return (results || []).some((r) => r.provider === provider);
  },

  dedupeById(items) {
    const seen = {};
    return items.filter((item) => {
      if (seen[item.id]) return false;
      seen[item.id] = true;
      return true;
    });
  },
};

// One-time move of legacy result files to the per-provider names. Returns false when a folder could not be
// read, so the caller can try again later instead of marking the migration as done.
function migrateLegacyResults_() {
  const entries = [];
  const taken = {};
  const visited = {};
  const handles = {};
  let complete = true;

  function walk(folder) {
    const folderId = folder.getId();
    if (visited[folderId]) return;
    visited[folderId] = true;
    const files = folder.getFiles();
    while (files.hasNext()) {
      try {
        const file = files.next();
        if (file.isTrashed()) continue;
        taken[folderId + '/' + file.getName()] = true;
        const info = DriveLogic.resultInfo(file.getName());
        if (!info || info.provider !== '') continue;
        const content = file.getBlob().getDataAsString();
        const parsed = info.kind === 'txt' ? Logic.parseTranscript(content) : Logic.parseTranscriptJson(content);
        if (!parsed) continue;
        handles[file.getId()] = file;
        entries.push({ id: file.getId(), folderId, name: file.getName(), kind: info.kind, audioFileId: parsed.audioFileId, provider: parsed.provider });
      } catch (e) {
        complete = false;
        console.log('migration skipped a file: ' + errorDetail_(e));
      }
    }
    const subfolders = folder.getFolders();
    while (subfolders.hasNext()) {
      const sub = subfolders.next();
      if (!sub.isTrashed()) walk(sub);
    }
  }

  getFolderIds_().forEach((folderId) => {
    try {
      walk(DriveApp.getFolderById(folderId));
    } catch (e) {
      complete = false;
      console.log('migration folder failed: ' + errorDetail_(e));
    }
  });
  DriveLogic.planMigration(entries, taken).forEach((rename) => {
    try {
      handles[rename.id].setName(rename.newName);
    } catch (e) {
      complete = false;
      console.log('migration rename failed: ' + errorDetail_(e));
    }
  });
  return complete;
}

const MAX_CACHED_TEXT = 90000;

// Transcript text keyed by file id and modification time, so unchanged files are not re-read.
function readTranscriptCached_(file) {
  const cache = CacheService.getScriptCache();
  const key = 't:' + file.getId() + ':' + file.getLastUpdated().getTime();
  const hit = cache.get(key);
  if (hit !== null) return hit;
  const content = file.getBlob().getDataAsString();
  try {
    if (content.length < MAX_CACHED_TEXT) cache.put(key, content, 6 * 3600);
  } catch (e) {
    // CacheService limits are in bytes; a text too large to cache is simply read again next time.
  }
  return content;
}

// Short exception text for diagnostics. Drive/Apps Script messages hold no file content.
function errorDetail_(e) {
  return String((e && e.message) || e).slice(0, 500);
}

// Walks every connected folder and its subfolders. A folder that cannot be read is
// reported in `errors` and does not stop the others. `transcripts` maps audioFileId ->
// [{provider, fileId, text}], one entry per provider that has a transcript file.
function listAudioFiles_() {
  const items = [];
  const errors = [];
  const transcripts = {};
  const visited = {};
  const jsonNames = {};

  function walk(folder, path) {
    const id = folder.getId();
    if (visited[id]) return;
    visited[id] = true;
    const files = folder.getFiles();
    while (files.hasNext()) {
      // One unreadable file must not hide the whole folder; it is skipped and logged (no names or text).
      try {
        const file = files.next();
        if (file.isTrashed()) continue;
        if (DriveLogic.isTranscriptName(file.getName())) {
          const parsed = Logic.parseTranscript(readTranscriptCached_(file));
          if (parsed) {
            if (!transcripts[parsed.audioFileId]) transcripts[parsed.audioFileId] = [];
            transcripts[parsed.audioFileId].push({ provider: DriveLogic.resultInfo(file.getName()).provider, fileId: file.getId(), text: parsed.text });
          }
        } else if (DriveLogic.isTranscriptJsonName(file.getName())) {
          jsonNames[id + '/' + file.getName()] = true;
        } else if (DriveLogic.isAudio(file.getMimeType(), file.getName())) {
          items.push({
            id: file.getId(),
            folderId: id,
            name: file.getName(),
            mimeType: file.getMimeType(),
            folderPath: path,
            modified: file.getLastUpdated().getTime(),
          });
        }
      } catch (e) {
        console.log('file skipped in folder scan: ' + errorDetail_(e));
      }
    }
    const subfolders = folder.getFolders();
    while (subfolders.hasNext()) {
      const sub = subfolders.next();
      if (!sub.isTrashed()) walk(sub, path + '/' + sub.getName());
    }
  }

  getFolderIds_().forEach((folderId) => {
    try {
      const folder = DriveApp.getFolderById(folderId);
      if (folder.isTrashed()) throw new Error('trashed');
      walk(folder, '/' + folder.getName());
    } catch (e) {
      const detail = errorDetail_(e);
      console.log('folder scan failed: ' + detail);
      errors.push({ folderId, message: 'folderUnavailable', detail });
    }
  });

  const unique = DriveLogic.dedupeById(items);
  unique.forEach((item) => {
    item.results = DriveLogic.resultsFor(item.name, item.folderId, transcripts[item.id], jsonNames);
  });
  return { items: unique, errors, transcripts };
}

// True when any parent chain of the file reaches a connected folder.
function isUnderConnectedFolder_(fileId) {
  const connected = getFolderIds_();
  const visited = {};
  let queue;
  try {
    queue = [DriveApp.getFileById(fileId)];
  } catch (e) {
    return false;
  }
  while (queue.length) {
    const next = [];
    for (let i = 0; i < queue.length; i++) {
      const parents = queue[i].getParents();
      while (parents.hasNext()) {
        const parent = parents.next();
        const id = parent.getId();
        if (connected.indexOf(id) !== -1) return true;
        if (!visited[id]) {
          visited[id] = true;
          next.push(parent);
        }
      }
    }
    queue = next;
  }
  return false;
}

// Every result file (text or JSON, any provider) of an audio file. The audio file id inside the file decides
// the match, not the name. `only` ({kind, provider}) skips the files that are not wanted before they are read.
function findResultFiles_(audioFile, only) {
  const found = [];
  // Iterates the folder instead of using Drive search, whose title matching and index lag are unreliable.
  const parents = audioFile.getParents();
  while (parents.hasNext()) {
    const files = parents.next().getFiles();
    while (files.hasNext()) {
      const file = files.next();
      if (file.isTrashed()) continue;
      const info = DriveLogic.resultInfo(file.getName());
      if (!info || (only && (info.kind !== only.kind || info.provider !== only.provider))) continue;
      const content = file.getBlob().getDataAsString();
      const parsed = info.kind === 'txt' ? Logic.parseTranscript(content) : Logic.parseTranscriptJson(content);
      if (parsed && parsed.audioFileId === audioFile.getId()) found.push({ file, kind: info.kind, provider: info.provider });
    }
  }
  return found;
}

function findResultFile_(audioFile, kind, provider) {
  const found = findResultFiles_(audioFile, { kind, provider });
  return found.length ? found[0].file : null;
}

const DURATION_CHUNK = 65536;

// Length of a recording from the container headers, read with two small Range requests
// (start and end of the file) instead of downloading it. Cached by id and modification time.
function estimateDuration_(fileId) {
  const file = DriveApp.getFileById(fileId);
  const name = file.getName();
  const encoding = Logic.encodingFor(name);
  if (encoding !== 'OGG_OPUS' && encoding !== 'LINEAR16' && encoding !== 'FLAC') return null;

  const cache = CacheService.getScriptCache();
  const key = 'd:' + fileId + ':' + file.getLastUpdated().getTime();
  const hit = cache.get(key);
  if (hit !== null) return JSON.parse(hit);

  const size = file.getSize();
  const url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media';
  const range = (from, to) => ({
    url,
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), Range: 'bytes=' + from + '-' + to },
  });
  const wholeFile = size <= DURATION_CHUNK;
  const requests = [range(0, Math.min(size, DURATION_CHUNK) - 1)];
  if (!wholeFile) requests.push(range(size - DURATION_CHUNK, size - 1));
  const responses = UrlFetchApp.fetchAll(requests);
  const ok = responses.every((r) => r.getResponseCode() === 200 || r.getResponseCode() === 206);
  if (!ok) return null;

  // A server that ignores Range sends the whole file (200); only the ends are needed either way.
  const head = responses[0].getContent().slice(0, DURATION_CHUNK);
  const lastBytes = responses[responses.length - 1].getContent();
  const tail = lastBytes.slice(Math.max(0, lastBytes.length - DURATION_CHUNK));
  const estimate = AudioDuration.estimate(name, head, wholeFile ? head : tail, size);
  if (estimate) cache.put(key, JSON.stringify(estimate), 6 * 3600);
  return estimate;
}

function trashFileAndResults_(fileId) {
  if (!isUnderConnectedFolder_(fileId)) throw new Error('Forbidden');
  const file = DriveApp.getFileById(fileId);
  findResultFiles_(file).forEach((result) => result.file.setTrashed(true));
  file.setTrashed(true);
}

if (typeof module !== 'undefined') module.exports = DriveLogic;
