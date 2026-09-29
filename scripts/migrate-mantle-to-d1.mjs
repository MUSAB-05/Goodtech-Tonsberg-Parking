// Copies every Mantle entry after its quota clears; keeps a local backup and verifies D1.
import fs from 'node:fs/promises';
import path from 'node:path';
import { APP_CONFIG } from '../config.js';

const api = String(process.env.PARKING_API_URL || '').replace(/\/$/, '');
const code = process.env.PARKING_ACCESS_CODE || '';
if (!/^https:\/\//.test(api) || !code) throw new Error('Set PARKING_API_URL and PARKING_ACCESS_CODE.');
const base = APP_CONFIG.mantleBaseUrl.replace(/\/$/, '');
const namespace = encodeURIComponent(APP_CONFIG.mantleNamespace);
const mantleHeaders = { 'X-Mantle-Key': APP_CONFIG.mantleKey };
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
    : value;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

async function mantle(url) {
  const response = await fetch(url, { headers: mantleHeaders });
  if (!response.ok) throw new Error(`Mantle returned ${response.status} at ${new URL(url).pathname}. Nothing was switched.`);
  return response.json();
}
async function d1(recordPath, method = 'GET', body) {
  const url = new URL(`${api}/v1/record`);
  url.searchParams.set('path', recordPath);
  const response = await fetch(url, {
    method, headers: { 'X-Parking-Code': code, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`D1 returned ${response.status} for ${recordPath}: ${data?.error}`);
  return data;
}

const listing = await mantle(`${base}/list/${namespace}`);
const paths = (listing.entries || []).map(entry => entry.path).filter(Boolean).sort();
if (!paths.some(entry => entry.startsWith('bookings/'))) throw new Error('Mantle listed no booking months. Refusing incomplete migration.');
const records = {};
for (const recordPath of paths) {
  records[recordPath] = await mantle(`${base}/${namespace}/${recordPath.split('/').map(encodeURIComponent).join('/')}`);
}
const directory = path.resolve('backups');
await fs.mkdir(directory, { recursive: true });
const backupPath = path.join(directory, `mantle-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await fs.writeFile(backupPath, JSON.stringify({ namespace: APP_CONFIG.mantleNamespace, copiedAt: new Date().toISOString(), entries: records }, null, 2), { mode: 0o600 });
console.log(`Saved ${paths.length} records (${(Buffer.byteLength(JSON.stringify(records)) / 1024).toFixed(1)} KiB) to ${backupPath}`);

for (const recordPath of paths) {
  const existing = await d1(recordPath);
  if (existing !== null && !equal(existing, records[recordPath])) {
    throw new Error(`D1 contains different data at ${recordPath}. Refusing to overwrite it.`);
  }
  if (existing === null) await d1(recordPath, 'PUT', records[recordPath]);
  if (!equal(await d1(recordPath), records[recordPath])) throw new Error(`Verification failed for ${recordPath}. Do not cut over.`);
}
console.log(`Verified ${paths.length} records. Mantle remains the live provider until config.js is switched.`);
