export class ParkingBackend {
  constructor({ baseUrl, namespace, key = '', fetchImpl = fetch, timeoutMs = 8000 }) {
    this.baseUrl = String(baseUrl || 'https://mantledb.sh/v2').replace(/\/$/, '');
    this.namespace = String(namespace || '').trim();
    this.key = String(key || '').trim();
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    if (!this.namespace) throw new Error('Shared parking namespace is not configured.');
  }

  path(month) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Invalid booking month.');
    return `bookings/${month}`;
  }

  url(path) { return `${this.baseUrl}/${encodeURIComponent(this.namespace)}/${path}`; }

  async request(path, { method = 'GET', body } = {}) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;
    try {
      // Keep this intentionally aligned with the working WB26 Mantle adapter.
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
      if (error?.kind === 'http') throw error;
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

  async setBooking(key, booking) {
    const month = String(key).slice(0, 7);
    await this.ensureMonth(month);
    await this.request(this.path(month), { method: 'PATCH', body: { [key]: booking || null } });
  }

  async healthCheck() {
    const path = `health/${Date.now()}`;
    await this.request(path, { method: 'POST', body: { ok: true } });
    const read = await this.request(path);
    await this.request(path, { method: 'DELETE' });
    return read?.ok === true;
  }
}
