const test = require('node:test');
const assert = require('node:assert');
const Logic = require('../src/Logic.js');

test('formatTime renders seconds as m:ss.d and h:mm:ss.d', () => {
  assert.strictEqual(Logic.formatTime(0), '0:00.0');
  assert.strictEqual(Logic.formatTime(65.34), '1:05.3');
  assert.strictEqual(Logic.formatTime(3725.5), '1:02:05.5');
});

test('formatTranscriptJson shows the segments as timed lines, not raw JSON', () => {
  const content = Logic.buildTranscriptJson('abc', 'groq', 'whisper-large-v3', {
    text: 'Ahoj světe', language: 'czech', duration: 12.5,
    segments: [{ start: 0, end: 5.2, text: ' Ahoj' }, { start: 5.2, end: 12.5, text: ' světe ' }],
  }, '2026-10-31T10:00:00.000Z');
  assert.strictEqual(Logic.formatTranscriptJson(content),
    'groq · whisper-large-v3 · czech · 0:12.5\n\n[0:00.0 – 0:05.2] Ahoj\n[0:05.2 – 0:12.5] světe');
});

test('formatTranscriptJson falls back to the plain text without segments, and to the input when it is not an envelope', () => {
  const content = Logic.buildTranscriptJson('abc', 'groq', 'm', { text: 'Jen text' }, '2026-10-31T10:00:00.000Z');
  assert.strictEqual(Logic.formatTranscriptJson(content), 'groq · m\n\nJen text');
  assert.strictEqual(Logic.formatTranscriptJson('not json'), 'not json');
});

test('formatTranscriptJson shows Deepgram utterances as timed lines', () => {
  const content = Logic.buildTranscriptJson('abc', 'deepgram', 'nova-3', {
    metadata: { duration: 12.5 },
    results: {
      channels: [{ detected_language: 'cs', alternatives: [{ transcript: 'Ahoj světe' }] }],
      utterances: [{ start: 0, end: 5.2, transcript: ' Ahoj' }, { start: 5.2, end: 12.5, transcript: 'světe ' }],
    },
  }, '2026-10-31T10:00:00.000Z');
  assert.strictEqual(Logic.formatTranscriptJson(content),
    'deepgram · nova-3 · cs · 0:12.5\n\n[0:00.0 – 0:05.2] Ahoj\n[0:05.2 – 0:12.5] světe');
});

test('formatTranscriptJson falls back to the channel transcript when Deepgram returns no utterances', () => {
  const content = Logic.buildTranscriptJson('abc', 'deepgram', 'nova-3', {
    results: { channels: [{ alternatives: [{ transcript: ' Jen text ' }] }] },
  }, '2026-10-31T10:00:00.000Z');
  assert.strictEqual(Logic.formatTranscriptJson(content), 'deepgram · nova-3\n\nJen text');
});

test('splitMatches marks every case-insensitive occurrence', () => {
  assert.deepStrictEqual(Logic.splitMatches('Ahoj ahoj světe', 'AHOJ'), [
    { text: 'Ahoj', match: true }, { text: ' ', match: false }, { text: 'ahoj', match: true }, { text: ' světe', match: false },
  ]);
});

test('splitMatches without a query or a hit returns the whole text unmarked', () => {
  assert.deepStrictEqual(Logic.splitMatches('abc', ''), [{ text: 'abc', match: false }]);
  assert.deepStrictEqual(Logic.splitMatches('abc', 'z'), [{ text: 'abc', match: false }]);
  assert.deepStrictEqual(Logic.splitMatches('', 'a'), []);
});

test('transcriptJsonName appends .transcript.json to the audio name', () => {
  assert.strictEqual(Logic.transcriptJsonName('call.opus'), 'call.opus.transcript.json');
});

test('buildTranscriptJson wraps the provider response with the audio file id', () => {
  const json = Logic.buildTranscriptJson('abc', 'groq', 'whisper-large-v3', { text: 'Ahoj', segments: [] }, '2026-10-31T10:00:00.000Z');
  assert.deepStrictEqual(JSON.parse(json), {
    format: 'GAS-TRANSCRIBE json v1', audioFileId: 'abc', provider: 'groq', model: 'whisper-large-v3',
    createdAt: '2026-10-31T10:00:00.000Z', response: { text: 'Ahoj', segments: [] },
  });
});

test('parseTranscriptJson returns the envelope, or null for anything else', () => {
  const json = Logic.buildTranscriptJson('abc', 'groq', 'm', { text: 'x' }, '2026-10-31T10:00:00.000Z');
  assert.strictEqual(Logic.parseTranscriptJson(json).audioFileId, 'abc');
  assert.strictEqual(Logic.parseTranscriptJson('not json'), null);
  assert.strictEqual(Logic.parseTranscriptJson('{"audioFileId":"abc"}'), null);
  assert.strictEqual(Logic.parseTranscriptJson('[]'), null);
});

test('splitLinks: plain text stays one text part', () => {
  assert.deepStrictEqual(Logic.splitLinks('no links here'), [{ text: 'no links here' }]);
  assert.deepStrictEqual(Logic.splitLinks(''), []);
});

test('splitLinks: urls become link parts, trailing punctuation stays text', () => {
  assert.deepStrictEqual(
    Logic.splitLinks('Open https://console.cloud.google.com/billing/create. Then (see https://a.example/x) go'),
    [
      { text: 'Open ' },
      { text: 'https://console.cloud.google.com/billing/create', href: 'https://console.cloud.google.com/billing/create' },
      { text: '. Then (see ' },
      { text: 'https://a.example/x', href: 'https://a.example/x' },
      { text: ') go' },
    ],
  );
});

test('splitLinks: only http(s) urls are linked', () => {
  assert.deepStrictEqual(Logic.splitLinks('javascript:alert(1)'), [{ text: 'javascript:alert(1)' }]);
});

const item = (over) => Object.assign(
  { id: 'i', name: 'a.opus', folderPath: '/A', modified: 1, status: 'none' }, over);

test('transcript round trip keeps id and multi-line text', () => {
  const content = Logic.buildTranscript('abc', 'Ahoj\nsvěte');
  assert.deepStrictEqual(Logic.parseTranscript(content), { audioFileId: 'abc', text: 'Ahoj\nsvěte' });
});

test('parseTranscript returns null without header', () => {
  assert.strictEqual(Logic.parseTranscript('jen text'), null);
});

test('transcriptFileName appends .transcript.txt to the full name', () => {
  assert.strictEqual(Logic.transcriptFileName('a.opus'), 'a.opus.transcript.txt');
});

test('encodingFor maps supported extensions and rejects others', () => {
  assert.strictEqual(Logic.encodingFor('x.opus', ''), 'OGG_OPUS');
  assert.strictEqual(Logic.encodingFor('X.OGG', ''), 'OGG_OPUS');
  assert.strictEqual(Logic.encodingFor('a.mp3', ''), 'MP3');
  assert.strictEqual(Logic.encodingFor('a.flac', ''), 'FLAC');
  assert.strictEqual(Logic.encodingFor('a.wav', ''), 'LINEAR16');
  assert.strictEqual(Logic.encodingFor('a.m4a', 'audio/mp4'), null);
});

test('filterItems search is case-insensitive without diacritics folding', () => {
  const items = [item({ id: '1', name: 'čeština.opus' })];
  assert.strictEqual(Logic.filterItems(items, { query: 'ČEŠ' }).length, 1);
  assert.strictEqual(Logic.filterItems(items, { query: 'ces' }).length, 0);
});

test('filterItems also searches transcript text', () => {
  const items = [item({ id: '1', transcriptText: 'dobrý den' }), item({ id: '2', name: 'b.opus' })];
  assert.deepStrictEqual(Logic.filterItems(items, { query: 'DEN' }).map((i) => i.id), ['1']);
});

test('filterItems returns html-looking names unchanged', () => {
  const items = [item({ name: '<img onerror=x>.opus' })];
  const out = Logic.filterItems(items, { query: 'img' });
  assert.strictEqual(out[0].name, '<img onerror=x>.opus');
});

test('filterItems matches composed queries against decomposed names', () => {
  const items = [item({ name: 'česky.opus' })];
  assert.strictEqual(Logic.filterItems(items, { query: 'česky' }).length, 1);
});

test('shouldReload is false while previously running files are still running', () => {
  const prev = [item({ id: '1', status: 'running' }), item({ id: '2', status: 'error' })];
  assert.strictEqual(Logic.shouldReload(prev, [{ fileId: '1', state: 'running' }]), false);
});

test('shouldReload is true when a running file finished or failed', () => {
  const prev = [item({ id: '1', status: 'running' })];
  assert.strictEqual(Logic.shouldReload(prev, [{ fileId: '1', state: 'done' }]), true);
  assert.strictEqual(Logic.shouldReload(prev, [{ fileId: '1', state: 'error', code: 'noSpeech' }]), true);
});

test('shouldReload is true when a running file is missing from the report', () => {
  assert.strictEqual(Logic.shouldReload([item({ id: '1', status: 'running' })], []), true);
});

test('filterItems hideTranscribed drops done items only', () => {
  const items = [item({ id: '1', status: 'done' }), item({ id: '2', status: 'running' }), item({ id: '3' })];
  assert.deepStrictEqual(Logic.filterItems(items, { hideTranscribed: true }).map((i) => i.id), ['2', '3']);
});

test('sortItems by date is newest first and does not mutate', () => {
  const items = [item({ id: '1', modified: 1 }), item({ id: '2', modified: 5 })];
  const sorted = Logic.sortItems(items, 'date');
  assert.deepStrictEqual(sorted.map((i) => i.id), ['2', '1']);
  assert.deepStrictEqual(items.map((i) => i.id), ['1', '2']);
});

test('sortItems by name is ascending', () => {
  const items = [item({ id: '1', name: 'b' }), item({ id: '2', name: 'a' })];
  assert.deepStrictEqual(Logic.sortItems(items, 'name').map((i) => i.id), ['2', '1']);
});

test('groupByFolder splits folder paths and keeps item order', () => {
  const items = [
    item({ id: '1', folderPath: '/A/B' }),
    item({ id: '2', folderPath: '/A' }),
    item({ id: '3', folderPath: '/A/B' }),
  ];
  const groups = Logic.groupByFolder(items);
  assert.deepStrictEqual(groups.map((g) => g.folderPath), ['/A', '/A/B']);
  assert.deepStrictEqual(groups[1].items.map((i) => i.id), ['1', '3']);
});
