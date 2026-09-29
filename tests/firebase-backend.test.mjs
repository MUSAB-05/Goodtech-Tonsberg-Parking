import test from 'node:test';
import assert from 'node:assert/strict';
import { FirebaseBackend } from '../firebase-backend.js';

function fakeBackend(initial = null) {
  let value = initial;
  let version = 1;
  const calls = [];
  const fetchImpl = async (url, options) => {
    if (url.includes('accounts:signUp')) return new Response(JSON.stringify({ idToken: 'test-token', refreshToken: 'refresh', expiresIn: '3600' }), { status: 200 });
    calls.push({ url, options });
    if (options.method === 'GET') return new Response(JSON.stringify(value), { status: 200, headers: { ETag: `"${version}"` } });
    if (options.headers['if-match'] !== `"${version}"`) return new Response(JSON.stringify({ error: 'ETag mismatch' }), { status: 412 });
    value = options.method === 'DELETE' ? null : JSON.parse(options.body);
    version++;
    return new Response(JSON.stringify(value), { status: 200 });
  };
  const backend = new FirebaseBackend({ databaseURL: 'https://example.firebasedatabase.app', apiKey: 'test', fetchImpl,
    storage: { getItem: () => null, setItem: () => {} } });
  return { backend, calls, get value() { return value; } };
}

test('parking claim uses a conditional write and refuses an occupied place', async () => {
  const fake = fakeBackend();
  const key = '2026-09-29__P1';
  await fake.backend.claimBooking(key, { driverId: 'alice' });
  assert.equal(fake.value.driverId, 'alice');
  assert.equal(fake.calls[1].options.headers['if-match'], '"1"');
  await assert.rejects(fake.backend.claimBooking(key, { driverId: 'bob' }), error => error.kind === 'busy');
});

test('old removal cannot erase another booking', async () => {
  const fake = fakeBackend({ driverId: 'bob' });
  await assert.rejects(fake.backend.clearBookingIfMatches('2026-09-29__P1', { driverId: 'alice' }), error => error.kind === 'stale');
  assert.equal(fake.value.driverId, 'bob');
});
