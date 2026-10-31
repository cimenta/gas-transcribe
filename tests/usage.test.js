const test = require('node:test');
const assert = require('node:assert');
const Usage = require('../src/Usage.js');

test('monthKey is the UTC year-month', () => {
  assert.strictEqual(Usage.monthKey(new Date('2026-10-31T23:59:00Z')), '2026-10');
  assert.strictEqual(Usage.monthKey(new Date('2026-11-01T00:00:00Z')), '2026-11');
});

test('record adds seconds within the same month', () => {
  const first = Usage.record(null, 90, '2026-10');
  assert.deepStrictEqual(first, { month: '2026-10', seconds: 90 });
  assert.deepStrictEqual(Usage.record(first, 30, '2026-10'), { month: '2026-10', seconds: 120 });
});

test('record starts from zero in a new month', () => {
  const old = { month: '2026-10', seconds: 3000 };
  assert.deepStrictEqual(Usage.record(old, 15, '2026-11'), { month: '2026-11', seconds: 15 });
});

test('record ignores negative or invalid seconds', () => {
  assert.deepStrictEqual(Usage.record({ month: '2026-10', seconds: 60 }, -5, '2026-10'), { month: '2026-10', seconds: 60 });
  assert.deepStrictEqual(Usage.record(null, NaN, '2026-10'), { month: '2026-10', seconds: 0 });
});

test('summary computes used, remaining and percent', () => {
  assert.deepStrictEqual(Usage.summary({ month: '2026-10', seconds: 900 }, '2026-10', 60), {
    month: '2026-10', usedSeconds: 900, limitSeconds: 3600, remainingSeconds: 2700, percent: 25, exceeded: false,
  });
});

test('summary treats a previous month as unused', () => {
  assert.strictEqual(Usage.summary({ month: '2026-09', seconds: 900 }, '2026-10', 60).usedSeconds, 0);
  assert.strictEqual(Usage.summary(null, '2026-10', 60).usedSeconds, 0);
});

test('summary caps remaining at zero and flags exceeded', () => {
  const s = Usage.summary({ month: '2026-10', seconds: 4000 }, '2026-10', 60);
  assert.strictEqual(s.remainingSeconds, 0);
  assert.strictEqual(s.exceeded, true);
  assert.strictEqual(s.percent, 100);
});

test('summary with a zero limit has no free minutes and no division by zero', () => {
  const s = Usage.summary({ month: '2026-10', seconds: 10 }, '2026-10', 0);
  assert.strictEqual(s.limitSeconds, 0);
  assert.strictEqual(s.percent, 100);
  assert.strictEqual(s.exceeded, true);
});
