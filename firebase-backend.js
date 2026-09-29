// Firebase Realtime Database adapter for the existing parking UI.
// Uses anonymous Firebase Auth and conditional writes for parking claims.
export class FirebaseBackend {
  constructor({ databaseURL, apiKey, fetchImpl = fetch, storage = localStorage }) {
    this.databaseURL = String(databaseURL || '').replace(/\/$/, '');
    this.apiKey = String(apiKey || '');
    if (!/^https:\/\//.test(this.databaseURL) || !this.apiKey) throw new Error('Firebase storage is not configured.');
    this.fetchImpl = fetchImpl;
    this.storage = storage;
    this.sessionKey = 'gt-parking-firebase-auth-v1';
    this.session = null;
    this.authInFlight = null;
  }

  async authenticate() {
    if (this.session?.expiresAt > Date.now() + 60000) return this.session.idToken;
    if (this.authInFlight) return this.authInFlight;
    this.authInFlight = this.refreshOrSignIn();
    try { return await this.authInFlight; }
    finally { this.authInFlight = null; }
  }

  async refreshOrSignIn() {
    let saved = this.session;
    if (!saved) {
      try { saved = JSON.parse(this.storage.getItem(this.sessionKey) || 'null'); } catch { /* sign in again */ }
    }
    if (saved?.idToken && saved.expiresAt > Date.now() + 60000) {
      this.session = saved;
      return saved.idToken;
    }
    if (saved?.refreshToken) {
      try {
        const response = await this.fetchImpl(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(this.apiKey)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: saved.refreshToken })
        });
        if (response.ok) {
          const data = await response.json();
          return this.saveSession(data.id_token, data.refresh_token, data.expires_in);
        }
      } catch { /* fall through to a new anonymous account */ }
    }
    const response = await this.fetchImpl(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(this.apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || 'Firebase sign-in failed.');
    return this.saveSession(data.idToken, data.refreshToken, data.expiresIn);
  }

  saveSession(idToken, refreshToken, expiresIn) {
    this.session = { idToken, refreshToken, expiresAt: Date.now() + Number(expiresIn || 3600) * 1000 };
    try { this.storage.setItem(this.sessionKey, JSON.stringify(this.session)); } catch { /* current tab still works */ }
    return idToken;
  }

  url(path, token) {
    return `${this.databaseURL}/${path}.json?auth=${encodeURIComponent(token)}`;
  }

  async request(path, { method = 'GET', body, etag = false, match } = {}) {
    const token = await this.authenticate();
    const headers = { 'Content-Type': 'application/json' };
    if (etag) headers['X-Firebase-ETag'] = 'true';
    if (match !== undefined) headers['if-match'] = match;
    const response = await this.fetchImpl(this.url(path, token), {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body)
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(result?.error || `Firebase storage error (${response.status})`);
      error.status = response.status;
      error.kind = response.status === 412 ? 'conflict' : 'http';
      throw error;
    }
    return etag ? { value: result, etag: response.headers.get('ETag') } : result;
  }

  monthPath(month) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Invalid booking month.');
    return `bookings/${month}`;
  }
  bookingPath(key) {
    if (!/^\d{4}-\d{2}-\d{2}__[^.$#[\]/\x00-\x1f]+$/.test(key)) throw new Error('Invalid booking key.');
    return `${this.monthPath(key.slice(0, 7))}/${key}`;
  }
  frequencyPath(spaceId) {
    if (!/^[^.$#[\]/\x00-\x1f]+$/.test(spaceId)) throw new Error('Invalid space ID.');
    return `frequency/${spaceId}`;
  }
  busyError() { const error = new Error('Place is busy.'); error.kind = 'busy'; return error; }
  staleError() { const error = new Error('Booking changed before removal.'); error.kind = 'stale'; return error; }
  valuesMatch(a, b) { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); }

  async getBookings(months) {
    const docs = await Promise.all([...new Set(months || [])].map(m => this.request(this.monthPath(m))));
    return Object.assign({}, ...docs.map(doc => doc || {}));
  }
  async patchMonth(month, changes) { await this.request(this.monthPath(month), { method: 'PATCH', body: changes }); }
  async setBooking(key, value) { await this.request(this.bookingPath(key), { method: 'PUT', body: value ?? null }); }
  async setBookings(changes) {
    for (const [key, value] of Object.entries(changes || {})) await this.setBooking(key, value);
  }
  async claimBooking(key, booking) {
    const path = this.bookingPath(key);
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.request(path, { etag: true });
      if (current.value?.driverId) {
        if (current.value.driverId === booking.driverId) return current.value;
        throw this.busyError();
      }
      try {
        await this.request(path, { method: 'PUT', body: booking, match: current.etag });
        return booking;
      } catch (error) { if (error.kind !== 'conflict') throw error; }
    }
    throw this.busyError();
  }
  async clearBookingIfMatches(key, expected) {
    const path = this.bookingPath(key);
    const current = await this.request(path, { etag: true });
    if (current.value == null) return { cleared: false, alreadyEmpty: true };
    if (!this.valuesMatch(current.value, expected)) throw this.staleError();
    try { await this.request(path, { method: 'DELETE', match: current.etag }); }
    catch (error) { if (error.kind === 'conflict') throw this.staleError(); throw error; }
    return { cleared: true };
  }
  async getPaydayEvents() { return (await this.request('social/payday-events')) || {}; }
  async setPaydayEvent(date, value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    await this.request(`social/payday-events/${date}`, { method: 'PUT', body: value ?? null });
  }
  async getGreenDeeds() { return (await this.request('social/green-deeds')) || {}; }
  async addGreenDeed(id, entry) {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('Invalid deed ID.');
    await this.request(`social/green-deeds/${id}`, { method: 'PUT', body: entry });
  }
  async getSpaceFrequency(spaceId) { return (await this.request(this.frequencyPath(spaceId))) || {}; }
  async setSpaceFrequency(spaceId, date, driverId) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    await this.request(`${this.frequencyPath(spaceId)}/${date}`, { method: 'PUT', body: driverId || null });
  }
  async healthCheck() { await this.request('meta/migration'); return true; }
}
