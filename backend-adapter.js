export class ParkingBackend {
  constructor({ baseUrl, namespace, key = '', fetchImpl = fetch, timeoutMs = 8000 }) {
    this.baseUrl = String(baseUrl || 'https://mantledb.sh/v2').replace(/\/$/, '');
    this.namespace = String(namespace || '').trim();
    this.key = String(key || '').trim();
    const nativeFetch = fetchImpl;
    this.fetchImpl = (...args) => Reflect.apply(nativeFetch, globalThis, args);
    this.timeoutMs = timeoutMs;
    if (!this.namespace) throw new Error('Shared parking namespace is not configured.');
  }

  path(month) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Invalid booking month.');
    return `bookings/${month}`;
  }

  frequencyPath(spaceId) { return `frequency/${encodeURIComponent(String(spaceId || ''))}`; }
  url(path) { return `${this.baseUrl}/${encodeURIComponent(this.namespace)}/${path}`; }

  async request(path, { method = 'GET', body } = {}) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this.key) headers['X-Mantle-Key'] = this.key;
      const response = await this.fetchImpl(this.url(path), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller?.signal
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (!response.ok) {
        const error = new Error(data?.error || data?.message || `Shared storage error (${response.status})`);
        error.status = response.status;
        error.kind = 'http';
        throw error;
      }
      return data;
    } catch (error) {
      if (error?.kind === 'http' || error?.kind === 'busy') throw error;
      const wrapped = new Error(error?.name === 'AbortError' ? 'Shared storage timed out.' : 'Shared storage is unreachable.');
      wrapped.kind = 'network';
      wrapped.cause = error;
      throw wrapped;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async ensureMonth(month) {
    try {
      return (await this.request(this.path(month))) || {};
    } catch (error) {
      if (error.status !== 404) throw error;
      await this.request(this.path(month), { method: 'POST', body: {} });
      return {};
    }
  }

  async getBookings(months) {
    const unique = [...new Set(months || [])];
    const docs = await Promise.all(unique.map(month => this.ensureMonth(month)));
    return Object.assign({}, ...docs);
  }

  async patchPath(path, changes) {
    const clean = changes && typeof changes === 'object' ? changes : {};
    if (!Object.keys(clean).length) return;
    try {
      await this.request(path, { method: 'PATCH', body: clean });
    } catch (error) {
      if (error.status !== 404) throw error;
      await this.request(path, { method: 'POST', body: {} });
      await this.request(path, { method: 'PATCH', body: clean });
    }
  }

  async patchMonth(month, changes) { return this.patchPath(this.path(month), changes); }

  valuesMatch(actual, expected) {
    const normalize = value => value == null ? null : value;
    return JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected));
  }

  busyError() {
    const error = new Error('Place is busy.');
    error.kind = 'busy';
    return error;
  }

  async claimBooking(key, booking) {
    const month = String(key).slice(0, 7);
    const desired = booking ?? null;
    if (!desired?.driverId) return this.setBooking(key, desired);

    const current = await this.ensureMonth(month);
    const existing = current?.[key] || null;
    if (existing?.driverId) {
      if (existing.driverId === desired.driverId) return existing;
      throw this.busyError();
    }

    await this.patchMonth(month, { [key]: desired });

    // Verify the final shared value. This catches near-simultaneous claims instead
    // of allowing the browser to assume it owns a space that another user won.
    const remote = await this.request(this.path(month));
    const finalValue = remote?.[key] || null;
    if (finalValue?.driverId !== desired.driverId) throw this.busyError();
    return finalValue;
  }

  async setBooking(key, booking) {
    const month = String(key).slice(0, 7);
    const desired = booking ?? null;
    try {
      await this.patchMonth(month, { [key]: desired });
      return;
    } catch (error) {
      try {
        const remote = await this.request(this.path(month));
        const actual = Object.prototype.hasOwnProperty.call(remote || {}, key) ? remote[key] : null;
        if (this.valuesMatch(actual, desired)) return;
      } catch {}
      throw error;
    }
  }

  async setBookings(changes) {
    const grouped = new Map();
    for (const [key, value] of Object.entries(changes || {})) {
      const month = String(key).slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) continue;
      if (!grouped.has(month)) grouped.set(month, {});
      grouped.get(month)[key] = value ?? null;
    }
    for (const [month, monthChanges] of grouped) await this.patchMonth(month, monthChanges);
  }

  async getSpaceFrequency(spaceId) {
    try {
      const result = await this.request(this.frequencyPath(spaceId));
      return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
    } catch (error) {
      if (error.status === 404) return {};
      throw error;
    }
  }

  async setSpaceFrequency(spaceId, date, driverId) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return;
    await this.patchPath(this.frequencyPath(spaceId), { [date]: driverId || null });
  }

  async healthCheck() {
    const path = `health/${Date.now()}`;
    await this.request(path, { method: 'POST', body: { ok: true } });
    const read = await this.request(path);
    await this.request(path, { method: 'DELETE' });
    return read?.ok === true;
  }
}
