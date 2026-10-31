const test = require('node:test');
const assert = require('node:assert');
const OperationsLogic = require('../src/Operations.js');

test('nextAction starts when there is no operation', () => {
  assert.strictEqual(OperationsLogic.nextAction(null), 'start');
});

test('nextAction reuses a running operation so double clicks do not start twice', () => {
  assert.strictEqual(OperationsLogic.nextAction({ state: 'running' }), 'reuse');
});

test('nextAction restarts after an error', () => {
  assert.strictEqual(OperationsLogic.nextAction({ state: 'error' }), 'start');
});

test('isSynchronous is true only when the provider already returned the text', () => {
  assert.strictEqual(OperationsLogic.isSynchronous({ text: 'ahoj' }), true);
  assert.strictEqual(OperationsLogic.isSynchronous({ text: '' }), true);
  assert.strictEqual(OperationsLogic.isSynchronous({ opName: 'operations/1' }), false);
});

test('isStale is false just under 24 hours', () => {
  assert.strictEqual(OperationsLogic.isStale({ startedAt: 0 }, 24 * 3600 * 1000), false);
});

test('isStale is true just over 24 hours', () => {
  assert.strictEqual(OperationsLogic.isStale({ startedAt: 0 }, 24 * 3600 * 1000 + 1), true);
});
