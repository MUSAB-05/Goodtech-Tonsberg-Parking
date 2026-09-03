export class ParkingBackend {
  constructor({ baseUrl, namespace, fetchImpl = fetch }) {
    this.baseUrl = String(baseUrl || 'https://mantledb.sh/v2').replace(/\/$/, '');
    this.namespace = String(namespace || '').trim();
    this.fetchImpl = fetchImpl;
    if (!this.namespace) throw new Error('Shared parking namespace is not configured.');
  }

  path(month) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Invalid booking month.');
    return `bookings/${month}`;
  }

  url(path) {
    return `${this.baseUrl}/${encodeURIComponent(this.namespace)}/${path}`;
  }

  async request(path, { method = 'GET', body } = {}) {
    const response = await this.fetchImpl(this.url(path), {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store'
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) {
      const error = new Error(data?.error || `Shared storage error (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return data;
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
    await this.request(this.path(month), {
      method: 'PATCH',
      body: { [key]: booking || null }
    });
  }
}
