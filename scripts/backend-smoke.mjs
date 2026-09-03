import assert from 'node:assert/strict';
import { APP_CONFIG } from '../config.js';
import { ParkingBackend } from '../backend-adapter.js';

const backend = new ParkingBackend({ baseUrl: APP_CONFIG.mantleBaseUrl, namespace: APP_CONFIG.mantleNamespace, timeoutMs: 12000 });
assert.equal(await backend.healthCheck(), true, 'MantleDB health check failed');

const corsUrl = `${APP_CONFIG.mantleBaseUrl}/${encodeURIComponent(APP_CONFIG.mantleNamespace)}/health/cors`;
const preflight = await fetch(corsUrl, {
  method: 'OPTIONS',
  headers: {
    Origin: 'https://musab-05.github.io',
    'Access-Control-Request-Method': 'PATCH',
    'Access-Control-Request-Headers': 'content-type'
  }
});
assert.ok(preflight.ok, `CORS preflight failed with ${preflight.status}`);
const allowOrigin = preflight.headers.get('access-control-allow-origin');
assert.ok(allowOrigin === '*' || allowOrigin === 'https://musab-05.github.io', `Unexpected CORS allow-origin: ${allowOrigin}`);
console.log('MantleDB network + CORS smoke test passed.');
