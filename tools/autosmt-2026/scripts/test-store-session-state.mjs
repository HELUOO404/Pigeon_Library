import assert from 'node:assert/strict';

const values = new Map();
globalThis.localStorage = {
  get length() { return values.size; },
  key(index) { return [...values.keys()][index] ?? null; },
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(String(key), String(value)); },
  removeItem(key) { values.delete(String(key)); },
};
globalThis.window = {
  dispatchEvent() {},
  CustomEvent: class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  },
};

const { createStore, setActiveUser } = await import('../../../app/src/core/store.js?session-state-test');

setActiveUser('local');
const store = createStore('session-state-course');
assert.deepEqual(store.get('progress', {}), {});
store.set('progress', { '1-1-1': 'read' });
assert.deepEqual(
  store.get('progress', {}),
  { '1-1-1': 'read' },
  'guest store must retain progress for the current page session',
);
assert.equal(
  [...values.keys()].some((key) => key.includes('session-state-course')),
  false,
  'guest session state must not be persisted to localStorage',
);

console.log('store-session-state: ok');
