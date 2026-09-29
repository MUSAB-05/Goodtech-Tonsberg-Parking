// Adapter for the Cloudflare Worker + D1 API. GitHub Pages remains the site host.
export class D1Backend {
  constructor({ apiUrl, fetchImpl = fetch, session = sessionStorage }) {
    this.apiUrl = String(apiUrl || '').replace(/\/$/, '');
    this.fetchImpl = fetchImpl;
    this.session = session;
    if (!/^https:\/\//.test(this.apiUrl)) throw new Error('Parking API is not configured.');
  }
  monthPath(month) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Invalid booking month.');
    return `bookings/${month}`;
  }
  valuesMatch(a, b) { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); }
  async request(route, path, { method = 'GET', body } = {}) {
    const code = this.session.getItem('gt-parking-access-code-v1');
    if (!code) throw new Error('Please enter the parking access code again.');
    const url = new URL(`${this.apiUrl}/v1/${route}`);
    if (path) url.searchParams.set('path', path);
    const response = await this.fetchImpl(url.toString(), {
      method, headers: { 'Content-Type': 'application/json', 'X-Parking-Code': code },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(result?.error || `Parking API error (${response.status})`);
      error.status = response.status;
      error.kind = response.status === 409 ? (route === 'clear' ? 'stale' : 'busy') : 'http';
      throw error;
    }
    return result;
  }
  async getBookings(months) {
    const docs = await Promise.all([...new Set(months || [])].map(month => this.request('record', this.monthPath(month))));
    return Object.assign({}, ...docs.map(doc => doc || {}));
  }
  async patchMonth(month, changes) { await this.request('record', this.monthPath(month), { method: 'PATCH', body: changes }); }
  async setBooking(key, booking) { await this.patchMonth(key.slice(0, 7), { [key]: booking ?? null }); }
  async setBookings(changes) {
    const months = new Map();
    for (const [key, value] of Object.entries(changes || {})) {
      const month = key.slice(0, 7);
      if (!months.has(month)) months.set(month, {});
      months.get(month)[key] = value ?? null;
    }
    for (const [month, values] of months) await this.patchMonth(month, values);
  }
  async claimBooking(key, booking) {
    await this.request('claim', this.monthPath(key.slice(0, 7)), { method: 'POST', body: { key, booking } });
    return booking;
  }
  async clearBookingIfMatches(key, expected) {
    await this.request('clear', this.monthPath(key.slice(0, 7)), { method: 'POST', body: { key, expected } });
    return { cleared: true };
  }
  async getPaydayEvents() { return (await this.request('record', 'social/payday-events')) || {}; }
  async setPaydayEvent(date, value) { await this.request('record', 'social/payday-events', { method: 'PATCH', body: { [date]: value ?? null } }); }
  async getGreenDeeds() { return (await this.request('record', 'social/green-deeds')) || {}; }
  async addGreenDeed(id, entry) { await this.request('record', 'social/green-deeds', { method: 'PATCH', body: { [id]: entry } }); }
  async getSpaceFrequency(spaceId) { return (await this.request('record', `frequency/${spaceId}`)) || {}; }
  async setSpaceFrequency(spaceId, date, driverId) {
    await this.request('record', `frequency/${spaceId}`, { method: 'PATCH', body: { [date]: driverId || null } });
  }
  async healthCheck() { return (await this.request('health'))?.ok === true; }
}
