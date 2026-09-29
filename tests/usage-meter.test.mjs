import test from 'node:test';
import assert from 'node:assert/strict';
import { recordMantleRequest, localMantleUsage } from '../usage-meter.js';

test('local request meter includes 429s and drops requests older than 24 hours', () => {
  const values = new Map();
  const storage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); }
  };
  const previousLocal = globalThis.localStorage;
  const previousSession = globalThis.sessionStorage;
  const previousNow = Date.now;
  try {
    globalThis.localStorage = storage;
    globalThis.sessionStorage = storage;
    let now = 1_000_000_000;
    Date.now = () => now;
    recordMantleRequest(200);
    recordMantleRequest(429);
    assert.deepEqual(localMantleUsage(), { attempts: 2, responses: 2, rateLimited: 1, networkFailures: 0 });
    now += 24 * 60 * 60 * 1000 + 1;
    recordMantleRequest(0);
    assert.deepEqual(localMantleUsage(), { attempts: 1, responses: 0, rateLimited: 0, networkFailures: 1 });
  } finally {
    Date.now = previousNow;
    globalThis.localStorage = previousLocal;
    globalThis.sessionStorage = previousSession;
  }
});
