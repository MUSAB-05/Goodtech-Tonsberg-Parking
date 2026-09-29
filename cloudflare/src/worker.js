const SITE_ORIGIN = 'https://musab-05.github.io';
const validPath = value => typeof value === 'string' && /^[a-z0-9_/-]{1,250}$/i.test(value)
  && !value.startsWith('/') && !value.endsWith('/') && !value.includes('//') && !value.includes('..');
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});
const equal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

async function authorized(request, env) {
  const code = request.headers.get('X-Parking-Code') || '';
  if (!code || !env.ACCESS_CODE_HASH) return false;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return hash === env.ACCESS_CODE_HASH;
}

async function getRecord(db, path) {
  const row = await db.prepare('SELECT data, version FROM records WHERE path = ?').bind(path).first();
  return row ? { value: JSON.parse(row.data), version: row.version } : { value: null, version: 0 };
}

async function compareAndSet(db, path, version, value) {
  const data = JSON.stringify(value);
  if (version === 0) {
    const result = await db.prepare('INSERT INTO records (path, data) VALUES (?, ?) ON CONFLICT(path) DO NOTHING')
      .bind(path, data).run();
    return result.meta.changes === 1;
  }
  const result = await db.prepare('UPDATE records SET data = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE path = ? AND version = ?')
    .bind(data, path, version).run();
  return result.meta.changes === 1;
}

async function changeRecord(db, path, update) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await getRecord(db, path);
    const next = update(current.value);
    if (next?.error) return json({ error: next.error }, next.status);
    if (await compareAndSet(db, path, current.version, next)) return json(next);
  }
  return json({ error: 'The booking changed. Please retry.' }, 409);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    if (origin && origin !== SITE_ORIGIN) return json({ error: 'Origin not allowed' }, 403);
    const cors = { 'Access-Control-Allow-Origin': SITE_ORIGIN, 'Access-Control-Allow-Headers': 'Content-Type, X-Parking-Code',
      'Access-Control-Allow-Methods': 'GET, PATCH, PUT, POST, OPTIONS', 'Vary': 'Origin' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let response;
    try {
      if (!await authorized(request, env)) return new Response(JSON.stringify({ error: 'Incorrect access code' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
      const url = new URL(request.url);
      const path = url.searchParams.get('path');
      if (url.pathname === '/v1/health' && request.method === 'GET') response = json({ ok: true });
      else if (!validPath(path)) response = json({ error: 'Invalid path' }, 400);
      else if (url.pathname === '/v1/record' && request.method === 'GET') response = json((await getRecord(env.DB, path)).value);
      else if (url.pathname === '/v1/record' && request.method === 'PATCH') {
        const changes = await request.json();
        if (!changes || Array.isArray(changes) || typeof changes !== 'object') response = json({ error: 'Invalid changes' }, 400);
        else response = await changeRecord(env.DB, path, current => {
          const next = { ...(current || {}) };
          for (const [key, value] of Object.entries(changes)) {
            if (value === null) delete next[key]; else next[key] = value;
          }
          return next;
        });
      } else if (url.pathname === '/v1/record' && request.method === 'PUT') {
        const next = await request.json();
        response = await changeRecord(env.DB, path, () => next);
      } else if (url.pathname === '/v1/claim' && request.method === 'POST') {
        const { key, booking } = await request.json();
        if (!/^bookings\/\d{4}-\d{2}$/.test(path) || typeof key !== 'string' || !key.startsWith(`${path.slice(-7)}-`) || !booking?.driverId) response = json({ error: 'Invalid claim' }, 400);
        else response = await changeRecord(env.DB, path, current => {
          const existing = current?.[key];
          if (existing?.driverId && existing.driverId !== booking.driverId) return { error: 'Place is busy.', status: 409 };
          return { ...(current || {}), [key]: booking };
        });
      } else if (url.pathname === '/v1/clear' && request.method === 'POST') {
        const { key, expected } = await request.json();
        if (!/^bookings\/\d{4}-\d{2}$/.test(path) || typeof key !== 'string' || !key.startsWith(`${path.slice(-7)}-`)) response = json({ error: 'Invalid removal' }, 400);
        else response = await changeRecord(env.DB, path, current => {
          const existing = current?.[key] ?? null;
          if (existing === null) return current || {};
          if (!equal(existing, expected)) return { error: 'Booking changed before removal.', status: 409 };
          const next = { ...current }; delete next[key]; return next;
        });
      } else response = json({ error: 'Not found' }, 404);
    } catch (error) {
      response = json({ error: error?.message || 'Storage error' }, 500);
    }
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  }
};
