import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/src/worker.js';

function database() {
  const rows = new Map();
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              const row = rows.get(args[0]);
              return row ? { data: JSON.stringify(row.value), version: row.version } : null;
            },
            async run() {
              if (sql.startsWith('INSERT')) {
                if (rows.has(args[0])) return { meta: { changes: 0 } };
                rows.set(args[0], { value: JSON.parse(args[1]), version: 1 });
              } else {
                const row = rows.get(args[1]);
                if (!row || row.version !== args[2]) return { meta: { changes: 0 } };
                rows.set(args[1], { value: JSON.parse(args[0]), version: row.version + 1 });
              }
              return { meta: { changes: 1 } };
            }
          };
        }
      };
    }
  };
}

test('D1 claims cannot take an occupied space and stale clears cannot erase it', async () => {
  const code = 'example-access-code';
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code)));
  const hash = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const env = { DB: database(), ACCESS_CODE_HASH: hash };
  const send = async (route, body) => {
    const request = new Request(`https://api.example/v1/${route}?path=bookings/2026-09`, {
      method: 'POST', headers: { Origin: 'https://musab-05.github.io', 'X-Parking-Code': code,
        'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const response = await worker.fetch(request, env);
    return { status: response.status, body: await response.json() };
  };
  const key = '2026-09-29__P1';
  assert.equal((await send('claim', { key, booking: { driverId: 'alice' } })).status, 200);
  assert.equal((await send('claim', { key, booking: { driverId: 'bob' } })).status, 409);
  assert.equal((await send('clear', { key, expected: { driverId: 'bob' } })).status, 409);
  assert.equal((await send('clear', { key, expected: { driverId: 'alice' } })).status, 200);
});
