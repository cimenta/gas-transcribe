const DriveLogic = {
  AUDIO_EXTENSIONS: ['opus', 'ogg', 'mp3', 'flac', 'wav', 'm4a'],

  isAudio(mimeType, fileName) {
    if (/^audio\//.test(mimeType || '')) return true;
    const ext = /\.([^.]+)$/.exec(fileName || '');
    return Boolean(ext) && DriveLogic.AUDIO_EXTENSIONS.indexOf(ext[1].toLowerCase()) !== -1;
  },

  isTranscriptName(fileName) {
    return /\.transcript\.txt$/.test(fileName || '');
  },

  isTranscriptJsonName(fileName) {
    return /\.transcript\.json$/.test(fileName || '');
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
// {fileId, text} for every transcript file found.
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
          if (parsed) transcripts[parsed.audioFileId] = { fileId: file.getId(), text: parsed.text };
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
    item.hasJson = Boolean(jsonNames[item.folderId + '/' + Logic.transcriptJsonName(item.name)]);
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

// Map of audioFileId -> transcript File for all transcripts stored directly in the folder.
function listTranscriptsInFolder_(folder) {
  const found = {};
  // Iterates the folder instead of using Drive search, whose title matching and index lag are unreliable.
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (file.isTrashed() || !DriveLogic.isTranscriptName(file.getName())) continue;
    const parsed = Logic.parseTranscript(file.getBlob().getDataAsString());
    if (parsed) found[parsed.audioFileId] = file;
  }
  return found;
}

function findTranscriptFile_(audioFile) {
  const parents = audioFile.getParents();
  while (parents.hasNext()) {
    const match = listTranscriptsInFolder_(parents.next())[audioFile.getId()];
    if (match) return match;
  }
  return null;
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

// The saved JSON result of a recording: iterates the folder (no Drive search) and checks the audio file id inside.
function findJsonFile_(audioFile) {
  const name = Logic.transcriptJsonName(audioFile.getName());
  const parents = audioFile.getParents();
  while (parents.hasNext()) {
    const files = parents.next().getFiles();
    while (files.hasNext()) {
      const file = files.next();
      if (file.isTrashed() || file.getName() !== name) continue;
      const parsed = Logic.parseTranscriptJson(file.getBlob().getDataAsString());
      if (parsed && parsed.audioFileId === audioFile.getId()) return file;
    }
  }
  return null;
}

function trashFileAndTranscript_(fileId) {
  if (!isUnderConnectedFolder_(fileId)) throw new Error('Forbidden');
  const file = DriveApp.getFileById(fileId);
  const transcript = findTranscriptFile_(file);
  if (transcript) transcript.setTrashed(true);
  const jsonFile = findJsonFile_(file);
  if (jsonFile) jsonFile.setTrashed(true);
  file.setTrashed(true);
}

if (typeof module !== 'undefined') module.exports = DriveLogic;
