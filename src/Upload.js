// Upload of an audio file from the browser into a connected Drive folder. The browser sends the file in
// chunks through google.script.run; the server forwards each chunk to a Drive resumable upload session,
// so no file has to fit into one call and nothing is kept on the server between chunks except the session.
const Upload = {
  MAX_BYTES: 100 * 1024 * 1024,
  // A multiple of 256 KiB, as the resumable upload protocol requires for every chunk but the last.
  CHUNK_BYTES: 2 * 1024 * 1024,
  ALIGN: 256 * 1024,
  MAX_NAME: 200,

  // The base name of what the browser reports, without control characters or a path.
  cleanName(name) {
    const base = String(name || '').replace(/[\u0000-\u001f\u007f]/g, '').split(/[\\/]/).pop().trim();
    if (!base || base === '.' || base === '..') return null;
    if (base.length <= Upload.MAX_NAME) return base;
    const ext = /\.[^.]{1,10}$/.exec(base);
    const tail = ext ? ext[0] : '';
    return base.slice(0, Upload.MAX_NAME - tail.length) + tail;
  },

  validate(name, size) {
    const logic = typeof Logic !== 'undefined' ? Logic : require('./Logic.js');
    if (!name || !logic.audioMime(name)) return { ok: false, code: 'unsupportedFormat' };
    if (!Number.isInteger(size) || size < 1) return { ok: false, code: 'generic' };
    if (size > Upload.MAX_BYTES) return { ok: false, code: 'uploadTooLarge' };
    return { ok: true, name };
  },

  // `taken` is a set of the names already in the folder; a clash gets " (1)", " (2)"... before the extension.
  uniqueName(name, taken) {
    if (!taken[name]) return name;
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let n = 1;
    while (taken[stem + ' (' + n + ')' + ext]) n++;
    return stem + ' (' + n + ')' + ext;
  },

  contentRange(offset, length, total) {
    return 'bytes ' + offset + '-' + (offset + length - 1) + '/' + total;
  },

  // A chunk must continue exactly where the previous one ended and be a multiple of 256 KiB unless it is the last.
  chunkOk(offset, length, total, expectedOffset) {
    if (!Number.isInteger(offset) || !Number.isInteger(length) || length < 1) return false;
    if (offset !== expectedOffset || offset + length > total) return false;
    return offset + length === total || length % Upload.ALIGN === 0;
  },

  sessionLocation(headers) {
    const key = Object.keys(headers || {}).find((k) => k.toLowerCase() === 'location');
    return key ? headers[key] : null;
  },
};

const UPLOAD_CACHE_PREFIX = 'u:';

function uploadFail_(code, detail) {
  const error = new Error(detail || code);
  error.code = code;
  error.detail = detail;
  return error;
}

// Opens a Drive resumable upload session in a connected folder and remembers it under a random id.
function uploadStart_(folderId, fileName, size) {
  if (getFolderIds_().indexOf(String(folderId)) === -1) throw new Error('Forbidden');
  const checked = Upload.validate(Upload.cleanName(fileName), Number(size));
  if (!checked.ok) throw uploadFail_(checked.code);

  const folder = DriveApp.getFolderById(String(folderId));
  const taken = {};
  const files = folder.getFiles();
  while (files.hasNext()) taken[files.next().getName()] = true;
  const name = Upload.uniqueName(checked.name, taken);
  const mime = Logic.audioMime(name);
  const total = Number(size);

  const response = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      'X-Upload-Content-Type': mime,
      'X-Upload-Content-Length': String(total),
    },
    payload: JSON.stringify({ name, parents: [String(folderId)], mimeType: mime }),
    muteHttpExceptions: true,
  });
  const sessionUri = response.getResponseCode() === 200 ? Upload.sessionLocation(response.getAllHeaders()) : null;
  if (!sessionUri) {
    throw uploadFail_('generic', 'drive upload ' + response.getResponseCode() + ': ' + GoogleSpeech.apiErrorMessage(response.getContentText()));
  }
  const uploadId = Utilities.getUuid();
  CacheService.getScriptCache().put(UPLOAD_CACHE_PREFIX + uploadId, JSON.stringify({ sessionUri, name, total, next: 0 }), 6 * 3600);
  return { uploadId, chunkSize: Upload.CHUNK_BYTES, name };
}

// Forwards one chunk (base64) to the session. Returns {done:false, next} or {done:true, fileId, name}.
function uploadChunk_(uploadId, offset, base64) {
  const cache = CacheService.getScriptCache();
  const key = UPLOAD_CACHE_PREFIX + String(uploadId);
  const raw = cache.get(key);
  if (!raw) throw uploadFail_('generic', 'upload session expired');
  const session = JSON.parse(raw);
  const bytes = Utilities.base64Decode(String(base64));
  const start = Number(offset);
  if (!Upload.chunkOk(start, bytes.length, session.total, session.next)) throw uploadFail_('generic', 'unexpected chunk');

  const response = UrlFetchApp.fetch(session.sessionUri, {
    method: 'put',
    contentType: 'application/octet-stream',
    headers: { 'Content-Range': Upload.contentRange(start, bytes.length, session.total) },
    payload: bytes,
    muteHttpExceptions: true,
    followRedirects: false,
  });
  const status = response.getResponseCode();
  if (status === 308) {
    session.next = start + bytes.length;
    cache.put(key, JSON.stringify(session), 6 * 3600);
    return { done: false, next: session.next };
  }
  if (status === 200 || status === 201) {
    cache.remove(key);
    return { done: true, fileId: JSON.parse(response.getContentText()).id, name: session.name };
  }
  throw uploadFail_('generic', 'drive upload ' + status + ': ' + GoogleSpeech.apiErrorMessage(response.getContentText()));
}

if (typeof module !== 'undefined') module.exports = Upload;
