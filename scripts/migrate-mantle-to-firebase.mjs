// Run only when Mantle reads work again. Copies every listed path, then verifies each value.
// Never clears the source and never overwrites a nonempty Firebase path.
import fs from 'node:fs/promises';
import path from 'node:path';
import { APP_CONFIG } from '../config.js';
import { FirebaseBackend } from '../firebase-backend.js';

const { FIREBASE_API_KEY, FIREBASE_DATABASE_URL } = process.env;
if (!FIREBASE_API_KEY || !FIREBASE_DATABASE_URL) {
  throw new Error('Set FIREBASE_API_KEY and FIREBASE_DATABASE_URL before migration.');
}

const base = APP_CONFIG.mantleBaseUrl.replace(/\/$/, '');
const namespace = encodeURIComponent(APP_CONFIG.mantleNamespace);
const headers = { 'X-Mantle-Key': APP_CONFIG.mantleKey };
const firebase = new FirebaseBackend({
  apiKey: FIREBASE_API_KEY, databaseURL: FIREBASE_DATABASE_URL,
  storage: { getItem: () => null, setItem: () => {} }
});
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
    : value;
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

async function mantleGet(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Mantle read failed (${response.status}) at ${new URL(url).pathname}. No cutover was made.`);
  return response.json();
}

const listing = await mantleGet(`${base}/list/${namespace}`);
const paths = (listing.entries || []).map(entry => entry.path).filter(Boolean).sort();
if (!paths.some(entry => entry.startsWith('bookings/'))) {
  throw new Error('No booking months were listed. Refusing an incomplete migration.');
}
const source = {};
for (const entry of paths) source[entry] = await mantleGet(`${base}/${namespace}/${entry.split('/').map(encodeURIComponent).join('/')}`);
const sourceBytes = Buffer.byteLength(JSON.stringify(source));
console.log(`Source data: ${(sourceBytes / 1024).toFixed(1)} KiB across ${paths.length} entries.`);

const directory = path.resolve('backups');
await fs.mkdir(directory, { recursive: true });
const backupPath = path.join(directory, `mantle-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await fs.writeFile(backupPath, JSON.stringify({ namespace: APP_CONFIG.mantleNamespace, copiedAt: new Date().toISOString(), entries: source }, null, 2), { mode: 0o600 });
console.log(`Saved ${paths.length} source entries to ${backupPath}`);

for (const entry of paths) {
  const existing = await firebase.request(entry);
  if (existing !== null) {
    if (!equal(existing, source[entry])) {
      throw new Error(`Destination already has different data at ${entry}. Stopped without overwriting it.`);
    }
    continue;
  }
  await firebase.request(entry, { method: 'PUT', body: source[entry] });
  const verified = await firebase.request(entry);
  if (!equal(verified, source[entry])) throw new Error(`Verification failed at ${entry}. Do not cut over.`);
}

await firebase.request('meta/migration', {
  method: 'PUT', body: { source: APP_CONFIG.mantleNamespace, copiedAt: new Date().toISOString(), entries: paths.length }
});
console.log(`Verified ${paths.length} entries. The site still uses Mantle until config.js is switched.`);
