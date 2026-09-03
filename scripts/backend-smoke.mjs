import assert from 'node:assert/strict';
import { APP_CONFIG } from '../config.js';
import { ParkingBackend } from '../backend-adapter.js';

const origin = 'https://musab-05.github.io';
const key = APP_CONFIG.mantleKey;
const backend = new ParkingBackend({ baseUrl: APP_CONFIG.mantleBaseUrl, namespace: APP_CONFIG.mantleNamespace, key, timeoutMs: 12000 });
assert.equal(await backend.healthCheck(), true, 'MantleDB health check failed');

const path = `health/browser-cors-${Date.now()}`;
const corsUrl = `${APP_CONFIG.mantleBaseUrl}/${encodeURIComponent(APP_CONFIG.mantleNamespace)}/${path}`;
const assertCors = (response, label) => {
  assert.ok(response.ok, `${label} failed with ${response.status}`);
  const allowOrigin = response.headers.get('access-control-allow-origin');
  assert.ok(allowOrigin === '*' || allowOrigin === origin, `${label} unexpected CORS allow-origin: ${allowOrigin}`);
};
const authHeaders = { Origin: origin, 'X-Mantle-Key': key };

const preflight = await fetch(corsUrl, {
  method: 'OPTIONS',
  headers: {
    Origin: origin,
    'Access-Control-Request-Method': 'PATCH',
    'Access-Control-Request-Headers': 'content-type,x-mantle-key'
  }
});
assertCors(preflight, 'CORS preflight');

const create = await fetch(corsUrl, {
  method: 'POST',
  headers: { ...authHeaders, 'Content-Type': 'application/json' },
  body: JSON.stringify({ ok: true, stage: 'created' })
});
assertCors(create, 'Browser-style POST');

const patch = await fetch(corsUrl, {
  method: 'PATCH',
  headers: { ...authHeaders, 'Content-Type': 'application/json' },
  body: JSON.stringify({ stage: 'patched' })
});
assertCors(patch, 'Browser-style PATCH');

const read = await fetch(corsUrl, { headers: authHeaders, cache: 'no-store' });
assertCors(read, 'Browser-style GET');
const data = await read.json();
assert.equal(data.stage, 'patched');

const remove = await fetch(corsUrl, { method: 'DELETE', headers: authHeaders });
assertCors(remove, 'Browser-style DELETE');

console.log('Claimed MantleDB namespace + full browser-style CORS smoke test passed.');
