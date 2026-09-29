import { APP_CONFIG } from './config.js';
import { ParkingBackend } from './backend-adapter.js';
import { ParkingMap } from './parking-map.js';
import { MeetingRoomView } from './meeting-room.js';
import { RoomDialogController } from './room-dialog-controller.js';
import { ScheduleView } from './schedule-view.js';
import {
  addDays, bookingKey, bookingsForDate, duplicateAssignments, flattenSpaces, formatDate, groupUsage,
  initialWeekDate, isoWeek, isoWeekYear, monthKey, normalAllocationUsage, parseDrivers, weekDates
} from './booking-utils.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

const state = {
  groups: [], meetingRoom: null, drivers: [], spaces: [], bookings: {}, week: [], selectedDate: '', today: '', selectedSpace: null,
  spaceFrequency: {}, paydayEvents: {}, greenDeeds: {}
};
let refreshInFlight = false;
let mutationsInFlight = 0;
let lastFingerprint = '';
let installPrompt = null;
let lastConnectionError = '';
const PENDING_KEY = 'gt-parking-pending-v1';
const PAYDAY_SLOT_ID = 'payday-drinks';
const PAYDAY_THRESHOLD = 4;
let pendingWrites = loadPendingWrites();
let pendingFlushInFlight = false;
let lastPaydayEventsRefresh = 0;
const SNAPSHOT_KEY = 'gt-parking-last-known-v1';
const RATE_LIMIT_PAUSE_MS = 30 * 60 * 1000;
let rateLimitUntil = Number(localStorage.getItem('gt-parking-rate-limit-until') || 0) || 0;
let hasSnapshot = false;

function noteRateLimit(error) {
  if (error?.status !== 429) return false;
  rateLimitUntil = Math.max(rateLimitUntil, Date.now() + RATE_LIMIT_PAUSE_MS);
  localStorage.setItem('gt-parking-rate-limit-until', String(rateLimitUntil));
  return true;
}

function loadSnapshot() {
  try {
    const saved = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || 'null');
    if (!saved || typeof saved !== 'object') return false;
    for (const name of ['bookings', 'paydayEvents', 'greenDeeds']) {
      if (saved[name] && typeof saved[name] === 'object' && !Array.isArray(saved[name])) state[name] = saved[name];
    }
    lastFingerprint = fingerprint(state.bookings);
    hasSnapshot = true;
    return true;
  } catch { return false; }
}

function saveSnapshot() {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      bookings: state.bookings, paydayEvents: state.paydayEvents, greenDeeds: state.greenDeeds
    }));
    hasSnapshot = true;
  } catch (error) { console.warn('Could not save parking snapshot', error); }
}


const backend = new ParkingBackend({
  baseUrl: APP_CONFIG.mantleBaseUrl,
  namespace: APP_CONFIG.mantleNamespace,
  key: APP_CONFIG.mantleKey
});

const map = new ParkingMap($('#parking-map'), {
  onSelect: openPicker,
  onDateChange: changeMapDate,
  onToday: goToday
});

const roomView = new MeetingRoomView($('#meeting-room'), {
  onFreeSlot: (hour, date) => roomController.openBooking(hour, date),
  onBookingClick: (key, date) => roomController.openDetails(key, date)
});

const scheduleView = new ScheduleView($('#schedule'), {
  state, dayBookings, duplicatesFor, openPicker, selectDate,
  openRoomDetails: (key, date) => roomController.openDetails(key, date),
  openPaydayVotes
});

function osloNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_CONFIG.timezone || 'Europe/Oslo', year:'numeric', month:'2-digit', day:'2-digit'
  }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type)?.value;
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  return { date, weekday: new Date(`${date}T12:00:00Z`).getUTCDay() };
}

function dateIso(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`;
}

function daysUntil(fromDate, toDate) {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86400000);
}

function easterDate(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

function isoWeekFriday(year, week = 27) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Weekday = jan4.getUTCDay() || 7;
  const friday = new Date(jan4);
  friday.setUTCDate(jan4.getUTCDate() - jan4Weekday + 1 + ((week - 1) * 7) + 4);
  return dateIso(friday);
}

function holidayCandidates(today) {
  const year = Number(String(today).slice(0, 4));
  const events = [];
  for (const y of [year, year + 1]) {
    events.push(
      { name:'17 May', icon:'🇳🇴', date:`${y}-05-17` },
      { name:'Summer break', icon:'☀️', date:isoWeekFriday(y, 27) },
      { name:'Halloween', icon:'🎃', date:`${y}-10-31` },
      { name:'Christmas', icon:'🎄', date:`${y}-12-24` },
      { name:'Easter', icon:'🐣', date:easterDate(y) }
    );
  }
  return events.filter(event => event.date >= today).sort((a,b) => a.date.localeCompare(b.date));
}

function confirmedPaydayDates() {
  const combined = { ...(state.paydayEvents || {}) };
  for (const [key, value] of Object.entries(state.bookings || {})) {
    const match = /^(\d{4}-\d{2}-\d{2})__payday-drinks$/.exec(key);
    if (!match) continue;
    if (value?.confirmed || (Array.isArray(value?.voterIds) && value.voterIds.length >= PAYDAY_THRESHOLD)) {
      combined[match[1]] = { confirmed:true, startHour:17 };
    } else {
      delete combined[match[1]];
    }
  }
  return Object.entries(combined)
    .filter(([date, value]) => date >= state.today && value?.confirmed)
    .map(([date]) => date)
    .sort();
}

function renderEventCountdown() {
  const element = $('#event-countdown');
  if (!element || !state.today) return;

  const payday = confirmedPaydayDates()[0];
  const event = payday
    ? { name:'Lønningspils', icon:'🍻', date:payday }
    : holidayCandidates(state.today)[0];

  if (!event) {
    element.textContent = '';
    element.hidden = true;
    return;
  }

  const days = daysUntil(state.today, event.date);
  const countdown = days === 0 ? 'Today' : days === 1 ? '1 day' : `${days} days`;
  element.hidden = false;
  element.innerHTML = `<span>NEXT EVENT</span><strong>${event.icon} ${esc(event.name)}</strong><b>${esc(countdown)}</b>`;
  element.title = `${event.name} · ${formatPaydayDate(event.date)}`;
}

async function refreshPaydayEvents(force = false) {
  if (!state.today) return;
  if (!force && Date.now() - lastPaydayEventsRefresh < 60000) return;
  try {
    state.paydayEvents = await backend.getPaydayEvents();
    lastPaydayEventsRefresh = Date.now();
    saveSnapshot();
    renderEventCountdown();
  } catch (error) {
    noteRateLimit(error);
    console.warn('Could not refresh Lønningspils countdown', error);
  }
}


function greenDeedCount() {
  return Object.values(state.greenDeeds || {}).filter(entry => entry && ['bike','walk','carpool'].includes(entry.type)).length;
}

function renderGreenDeeds() {
  const count = $('#green-deeds-count');
  if (count) count.textContent = String(greenDeedCount());
}

function openDialogSafe(dialog) {
  if (!dialog || dialog.open) return;
  try {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  } catch {
    dialog.setAttribute('open', '');
  }
}

function closeDialogSafe(dialog) {
  if (!dialog) return;
  try {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  } catch {
    dialog.removeAttribute('open');
  }
}

async function refreshGreenDeeds() {
  try {
    state.greenDeeds = await backend.getGreenDeeds();
    saveSnapshot();
    renderGreenDeeds();
  } catch (error) {
    noteRateLimit(error);
    console.warn('Could not refresh Green deeds', error);
  }
}

async function addGreenDeed(type) {
  if (!['bike','walk','carpool'].includes(type)) return;
  const id = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const entry = { type, date:state.today, createdAt:new Date().toISOString() };
  try {
    await backend.addGreenDeed(id, entry);
    state.greenDeeds[id] = entry;
    renderGreenDeeds();
    closeDialogSafe($('#green-deeds-dialog'));
    toast('🌱 Green deed added');
  } catch (error) {
    console.error(error);
    toast('Could not save. Try again.');
  }
}

function fingerprint(bookings) {
  return JSON.stringify(Object.entries(bookings || {}).sort(([a],[b]) => a.localeCompare(b)));
}

function spaceById(id) { return state.spaces.find(space => space.id === id); }
function driverById(id) { return state.drivers.find(driver => driver.id === id); }
function dayBookings(date) { return bookingsForDate(state.bookings, date, state.spaces); }
function duplicatesFor(date) { return duplicateAssignments(dayBookings(date)); }
function visibleMonths() { return [...new Set(state.week.map(monthKey))]; }

function parkingKeyParts(key) {
  const match = /^(\d{4}-\d{2}-\d{2})__(.+)$/.exec(String(key || ''));
  if (!match || match[2].startsWith('meeting-room__') || match[2] === PAYDAY_SLOT_ID) return null;
  return { date: match[1], spaceId: match[2] };
}

function mergeVisibleMonths(current, remote, months) {
  const visible = new Set(months || []);
  const merged = {};
  for (const [key, value] of Object.entries(current || {})) {
    if (!visible.has(String(key).slice(0, 7))) merged[key] = value;
  }
  return Object.assign(merged, remote || {});
}

function localFrequencyForSpace(spaceId) {
  const result = {};
  const suffix = `__${spaceId}`;
  for (const [key, booking] of Object.entries(state.bookings || {})) {
    if (key.endsWith(suffix) && booking?.driverId && /^\d{4}-\d{2}-\d{2}__/.test(key)) result[key.slice(0,10)] = booking.driverId;
  }
  return result;
}

async function recordFrequencyForBookingKey(key, value) {
  const parts = parkingKeyParts(key);
  if (!parts) return;
  try {
    await backend.setSpaceFrequency(parts.spaceId, parts.date, value?.driverId || null);
    state.spaceFrequency[parts.spaceId] = { ...(state.spaceFrequency[parts.spaceId] || {}), [parts.date]: value?.driverId || null };
  } catch (error) {
    console.warn('Could not update parking frequency history', parts.spaceId, error);
  }
}

async function loadSpaceFrequency(spaceId) {
  const local = localFrequencyForSpace(spaceId);
  try {
    const remote = await backend.getSpaceFrequency(spaceId);
    const merged = { ...remote, ...local };
    state.spaceFrequency[spaceId] = merged;
    const missing = Object.entries(local).filter(([date, driverId]) => remote?.[date] !== driverId);
    Promise.allSettled(missing.map(([date, driverId]) => backend.setSpaceFrequency(spaceId, date, driverId)));
  } catch (error) {
    state.spaceFrequency[spaceId] = { ...(state.spaceFrequency[spaceId] || {}), ...local };
    console.warn('Could not load parking frequency history', spaceId, error);
  }
  if (state.selectedSpace?.spaceId === spaceId && $('#picker')?.open) renderDrivers();
}

function validPendingKey(key) { return /^\d{4}-\d{2}-\d{2}__.+/.test(String(key || '')); }
function pendingValue(entry) {
  if (entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'value')) return entry.value ?? null;
  return entry ?? null;
}
function loadPendingWrites() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([key]) => validPendingKey(key)));
  } catch { return {}; }
}
function savePendingWrites() { localStorage.setItem(PENDING_KEY, JSON.stringify(pendingWrites)); }
function queuePendingWrite(key, value) {
  pendingWrites[key] = { value: value ?? null, queuedAt: new Date().toISOString() };
  savePendingWrites();
}
function clearPendingWrite(key) {
  delete pendingWrites[key];
  savePendingWrites();
}
function applyPendingWrites(bookings) {
  const merged = { ...(bookings || {}) };
  for (const [key, entry] of Object.entries(pendingWrites)) {
    const value = pendingValue(entry);
    if (value == null) delete merged[key]; else merged[key] = value;
  }
  return merged;
}
async function persistShared(key, value) {
  queuePendingWrite(key, value);
  try {
    await backend.setBooking(key, value);
    clearPendingWrite(key);
    return { synced: true };
  } catch (error) {
    noteRateLimit(error);
    return { synced: false, error };
  }
}
async function flushPendingWrites() {
  if (pendingFlushInFlight || !Object.keys(pendingWrites).length) return true;
  pendingFlushInFlight = true;
  const failures = [];
  try {
    for (const [key, entry] of Object.entries({ ...pendingWrites })) {
      if (!validPendingKey(key)) {
        clearPendingWrite(key);
        continue;
      }
      const value = pendingValue(entry);
      try {
        if (parkingKeyParts(key) && value?.driverId) await backend.claimBooking(key, value);
        else await backend.setBooking(key, value);
        clearPendingWrite(key);
        await recordFrequencyForBookingKey(key, value);
      } catch (error) {
        if (error?.kind === 'busy') {
          // Old offline claims must never overwrite a space that somebody else now owns.
          clearPendingWrite(key);
          continue;
        }
        noteRateLimit(error);
        failures.push(error);
        console.warn('Pending booking sync failed', key, error);
      }
    }
    if (failures.length) throw failures[0];
    return true;
  } finally {
    pendingFlushInFlight = false;
  }
}

function setConnection(label, status = '', detail = '') {
  const element = $('#connection');
  element.textContent = label;
  element.className = `connection ${status}`.trim();
  element.title = detail || label;
  if (status === 'live') lastConnectionError = '';
  else if (detail) lastConnectionError = detail;
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 2600);
}

function render() {
  if (!state.groups.length || !state.week.length) return;
  const bookings = dayBookings(state.selectedDate);
  const duplicates = duplicatesFor(state.selectedDate);
  $('#selected-date-title').textContent = formatDate(state.selectedDate, { weekday:'long', day:'numeric', month:'long' });
  $('#week-label').textContent = `Week ${String(isoWeek(state.week[0])).padStart(2,'0')} · ${isoWeekYear(state.week[0])}`;
  renderSummary(bookings);
  renderEventCountdown();
  renderGreenDeeds();
  renderPaydayMobile();
  scheduleView.render();
  map.render(state.groups, bookings, state.selectedDate, state.drivers, duplicates);
  roomView.render(state.bookings, state.selectedDate, state.drivers);
}

function paydayKey(date) { return bookingKey(date, PAYDAY_SLOT_ID); }

function formatPaydayDate(date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone:'UTC',
    weekday:'long',
    day:'numeric',
    month:'long'
  }).format(new Date(`${date}T12:00:00Z`));
}

function paydayVoteIds(date, source = state.bookings) {
  const value = source?.[paydayKey(date)];
  const valid = new Set(state.drivers.filter(driver => driver.id !== 'guest').map(driver => driver.id));
  return [...new Set(Array.isArray(value?.voterIds) ? value.voterIds.filter(id => valid.has(id)) : [])];
}

function paydayStatus(date) {
  const voterIds = paydayVoteIds(date);
  return { voterIds, count: voterIds.length, confirmed: voterIds.length >= PAYDAY_THRESHOLD };
}

function renderPaydayMobile() {
  const container = $('#payday-mobile');
  if (!container || !state.week.length) return;
  const days = state.week.map(date => {
    const status = paydayStatus(date);
    const day = formatDate(date, { weekday:'short' });
    const dateLabel = formatDate(date, { day:'numeric', month:'short' });
    const value = status.confirmed ? '🍻 17:00' : 'Vote';
    return `<button type="button" class="payday-mobile-day ${status.confirmed ? 'confirmed' : ''} ${date === state.today ? 'today' : ''}" data-payday-mobile-date="${date}"><span>${esc(day)}</span><b>${esc(dateLabel)}</b><strong>${value}</strong></button>`;
  }).join('');
  container.innerHTML = `<div class="payday-mobile-head"><div><small>SOSIALT</small><strong>🍻 Lønningspils</strong></div></div><div class="payday-mobile-days">${days}</div>`;
  container.querySelectorAll('[data-payday-mobile-date]').forEach(button => button.addEventListener('click', () => openPaydayVotes(button.dataset.paydayMobileDate)));
}

function openPaydayVotes(date) {
  state.selectedPaydayDate = date;
  renderPaydayDialog();
  const dialog = $('#payday-dialog');
  if (dialog && !dialog.open) dialog.showModal();
}

function renderPaydayDialog() {
  const date = state.selectedPaydayDate;
  const content = $('#payday-dialog-content');
  if (!date || !content) return;
  const status = paydayStatus(date);
  const selected = new Set(status.voterIds);
  const drivers = state.drivers.filter(driver => driver.id !== 'guest');
  const headline = status.confirmed
    ? '🍻 Confirmed · 17:00'
    : 'Who can join?';
  content.innerHTML = `<div class="payday-dialog-inner">
    <div class="picker-head">
      <div><p class="eyebrow">LØNNINGSPILS</p><h2>${esc(formatPaydayDate(date))}</h2></div>
      <button class="icon-button" type="button" data-payday-close aria-label="Close">×</button>
    </div>
    <p class="payday-dialog-status ${status.confirmed ? 'confirmed' : ''}">${esc(headline)}</p>
    <div class="driver-list payday-voter-list">${drivers.map(driver => {
      const canJoin = selected.has(driver.id);
      return `<button type="button" class="driver-option payday-voter ${canJoin ? 'selected' : ''}" data-payday-driver-id="${esc(driver.id)}"><span class="avatar">${esc(driver.name.slice(0,1).toUpperCase())}</span><span><strong>${esc(driver.name)}</strong><small>${canJoin ? '✓ In' : 'Vote'}</small></span></button>`;
    }).join('')}</div>
  </div>`;
  content.querySelector('[data-payday-close]')?.addEventListener('click', () => $('#payday-dialog')?.close());
  content.querySelectorAll('[data-payday-driver-id]').forEach(button => button.addEventListener('click', () => togglePaydayVote(button.dataset.paydayDriverId)));
}

async function togglePaydayVote(driverId) {
  const date = state.selectedPaydayDate;
  if (!date || !driverId || driverId === 'guest') return;
  const key = paydayKey(date);
  const localIds = paydayVoteIds(date);
  const shouldJoin = !localIds.includes(driverId);
  mutationsInFlight++;
  try {
    let source = state.bookings;
    try { source = await backend.getBookings([monthKey(date)]); } catch {}
    const ids = paydayVoteIds(date, source).filter(id => id !== driverId);
    if (shouldJoin) ids.push(driverId);
    const voterIds = [...new Set(ids)];
    const value = voterIds.length ? {
      kind: PAYDAY_SLOT_ID,
      voterIds,
      confirmed: voterIds.length >= PAYDAY_THRESHOLD,
      startHour: 17,
      updatedAt: new Date().toISOString()
    } : null;
    await backend.setBooking(key, value);
    if (value) state.bookings[key] = value; else delete state.bookings[key];
    try {
      const summary = value?.confirmed ? { confirmed:true, startHour:17, updatedAt:value.updatedAt } : null;
      await backend.setPaydayEvent(date, summary);
      if (summary) state.paydayEvents[date] = summary; else delete state.paydayEvents[date];
    } catch (summaryError) {
      console.warn('Could not update Lønningspils countdown', summaryError);
    }
    render();
    renderPaydayDialog();
    if (value?.confirmed) toast('🍻 Lønningspils confirmed · 17:00');
    else toast(shouldJoin ? "You're in" : 'Removed');
    setConnection('Live', 'live', 'Shared bookings are synchronized.');
  } catch (error) {
    console.error(error);
    setConnection(navigator.onLine === false ? 'Offline' : 'Sync issue', 'offline', error.message);
    toast('Could not save. Try again.');
  } finally {
    mutationsInFlight--;
    await reloadBookings(true);
    if ($('#payday-dialog')?.open) renderPaydayDialog();
  }
}

function renderSummary(bookings) {
  $('#daily-summary').innerHTML = state.groups.map(group => {
    const used = group.id === 'mg-basement' ? normalAllocationUsage(bookings, group) : groupUsage(bookings, group);
    const extra = group.id === 'mg-basement' && used > group.limit;
    const detail = group.id === 'mg-basement'
      ? (extra ? `${used}/${group.limit} ⚠ extra MG` : `${used}/${group.limit} normal allocation`)
      : `${used}/${group.limit} used`;
    return `<div class="summary-item ${extra ? 'warning' : ''}"><span>${esc(group.shortName || group.name)}</span><strong>${esc(detail)}</strong></div>`;
  }).join('');
}

function selectDate(date) {
  state.selectedDate = date;
  const monday = weekDates(date)[0];
  const weekChanged = monday !== state.week[0];
  if (weekChanged) state.week = weekDates(date);
  render();
  if (weekChanged) reloadBookings(true);
}

function changeMapDate(date, amount) { selectDate(addDays(date, amount)); }
function goToday() {
  const now = osloNow();
  state.today = now.date;
  selectDate(now.date);
  reloadBookings(true);
}

function openPicker(spaceId, date) {
  const space = spaceById(spaceId);
  if (!space) return;
  state.selectedSpace = { spaceId, date };
  state.selectedDate = date;
  $('#picker-title').textContent = `${space.name} · ${formatDate(date, { weekday:'short', day:'numeric', month:'short' })}`;
  $('#driver-search').value = '';
  renderDrivers();
  $('#picker').showModal();
  render();
  loadSpaceFrequency(spaceId);
}

function renderDrivers() {
  const query = $('#driver-search').value.trim().toLocaleLowerCase();
  const spaceId = state.selectedSpace?.spaceId;
  const history = state.spaceFrequency[spaceId] || localFrequencyForSpace(spaceId);
  const counts = new Map();
  for (const driverId of Object.values(history || {})) {
    if (!driverId) continue;
    counts.set(driverId, (counts.get(driverId) || 0) + 1);
  }
  const filtered = state.drivers
    .filter(driver => driver.name.toLocaleLowerCase().includes(query))
    .sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0) || a.sortOrder - b.sortOrder);
  $('#driver-list').innerHTML = filtered.length ? filtered.map(driver => {
    return `<button type="button" class="driver-option" data-driver-id="${esc(driver.id)}"><span class="avatar">${esc(driver.name.slice(0,1).toUpperCase())}</span><span><strong>${esc(driver.name)}</strong></span></button>`;
  }).join('') : '<p class="empty-state">No employees found</p>';
  $('#driver-list').querySelectorAll('[data-driver-id]').forEach(element => element.addEventListener('click', () => saveParkingBooking(element.dataset.driverId)));
}

async function saveParkingBooking(driverId) {
  await updateParkingBooking({ driverId, updatedAt: new Date().toISOString() });
}
async function clearParkingBooking() { await updateParkingBooking(null); }

async function updateParkingBooking(value) {
  if (!state.selectedSpace) return;
  const { spaceId, date } = state.selectedSpace;
  const key = bookingKey(date, spaceId);
  const current = state.bookings[key] || null;

  if (value) {
    if (current?.driverId) return toast('Place is busy.');
    mutationsInFlight++;
    try {
      await backend.claimBooking(key, value);
      state.bookings[key] = value;
      clearPendingWrite(key);
      await recordFrequencyForBookingKey(key, value);
      $('#picker').close();
      state.selectedSpace = null;
      render();
      setConnection('Live', 'live', 'Shared bookings are synchronized.');
      toast(`${driverById(value.driverId)?.name || 'Employee'} assigned`);
    } catch (error) {
      if (error?.kind === 'busy') toast('Place is busy.');
      else {
        setConnection(navigator.onLine === false ? 'Offline' : 'Sync issue', 'offline', error.message);
        toast('Could not claim the parking space. Try again.');
      }
    } finally {
      mutationsInFlight--;
      await reloadBookings(true);
    }
    return;
  }

  if (!current) {
    $('#picker').close();
    state.selectedSpace = null;
    return;
  }

  delete state.bookings[key];
  $('#picker').close();
  mutationsInFlight++;
  render();
  try {
    const result = await persistShared(key, null);
    if (result.synced) {
      await recordFrequencyForBookingKey(key, null);
      setConnection('Live', 'live', 'Shared bookings are synchronized.');
      toast('Parking space cleared');
    } else {
      setConnection('Sync pending', 'pending', `${result.error?.message || 'Shared storage unavailable'} Removal is saved on this device and will retry automatically.`);
      toast('Removal saved on this device · shared sync pending');
    }
  } finally {
    mutationsInFlight--;
    state.selectedSpace = null;
    await reloadBookings(true);
  }
}

async function reloadBookings(force = false) {
  if (refreshInFlight || mutationsInFlight || !state.week.length) return;
  if (Date.now() < rateLimitUntil) {
    setConnection(hasSnapshot ? 'Cached · rate limited' : 'Rate limited', 'pending', 'MantleDB is rate limited. Retrying after a 30 minute pause.');
    return;
  }
  refreshInFlight = true;
  let syncError = null;
  try {
    if (Object.keys(pendingWrites).length) {
      try { await flushPendingWrites(); }
      catch (error) { syncError = error; }
    }
    const months = visibleMonths();
    let nextBase = state.bookings || {};
    let gotRemote = false;
    try {
      const remote = await backend.getBookings(months);
      nextBase = mergeVisibleMonths(state.bookings, remote, months);
      gotRemote = true;
    } catch (error) {
      noteRateLimit(error);
      syncError = syncError || error;
    }
    const next = applyPendingWrites(nextBase);
    const nextFingerprint = fingerprint(next);
    if (force || nextFingerprint !== lastFingerprint) {
      state.bookings = next;
      lastFingerprint = nextFingerprint;
      if (gotRemote) saveSnapshot();
      render();
    }
    if (Date.now() >= rateLimitUntil) await refreshPaydayEvents(force);
    if (force && Date.now() >= rateLimitUntil) await refreshGreenDeeds();
    const pendingCount = Object.keys(pendingWrites).length;
    if (pendingCount) {
      setConnection(`Sync pending (${pendingCount})`, 'pending', `${syncError?.message || 'Shared storage unavailable.'} ${pendingCount} local change${pendingCount === 1 ? '' : 's'} queued for retry.`);
    } else if (syncError) {
      if (syncError.status === 429) setConnection(hasSnapshot ? 'Cached · rate limited' : 'Rate limited', 'pending', 'MantleDB is rate limited. Retrying after a 30 minute pause.');
      else setConnection(navigator.onLine === false ? 'Offline' : 'Sync issue', 'offline', syncError.message);
    } else {
      rateLimitUntil = 0;
      localStorage.removeItem('gt-parking-rate-limit-until');
      setConnection('Live', 'live', 'Shared bookings are synchronized.');
    }
  } catch (error) {
    console.error(error);
    noteRateLimit(error);
    state.bookings = applyPendingWrites(state.bookings);
    render();
    const pendingCount = Object.keys(pendingWrites).length;
    setConnection(pendingCount ? `Sync pending (${pendingCount})` : (navigator.onLine === false ? 'Offline' : 'Sync issue'), pendingCount ? 'pending' : 'offline', error.message);
  } finally {
    refreshInFlight = false;
  }
}

const roomController = new RoomDialogController({
  state, backend, driverById, selectDate, render, setConnection, toast, reloadBookings, persistShared,
  beginMutation: () => { mutationsInFlight++; },
  endMutation: () => { mutationsInFlight--; }
});

function shiftWeek(amount) {
  state.week = weekDates(addDays(state.week[0], amount * 7));
  state.selectedDate = addDays(state.selectedDate, amount * 7);
  render();
  reloadBookings(true);
}

function applyTheme(theme) {
  document.body.classList.toggle('light', theme === 'light');
  localStorage.setItem('gt-parking-theme', theme);
  $('#theme-toggle').textContent = theme === 'light' ? '☾' : '☼';
  $('#theme-toggle').setAttribute('aria-label', theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
}

async function init() {
  try {
    setConnection('Connecting…', 'checking', 'Checking shared storage.');
    const [configResponse, driversResponse] = await Promise.all([
      fetch('./parking-config.json', { cache:'no-store' }),
      fetch('./drivers.txt', { cache:'no-store' })
    ]);
    if (!configResponse.ok || !driversResponse.ok) throw new Error('Could not load parking configuration.');
    const config = await configResponse.json();
    state.groups = config.groups;
    state.meetingRoom = config.meetingRoom;
    state.drivers = parseDrivers(await driversResponse.text());
    state.spaces = flattenSpaces(state.groups).sort((a, b) => a.displayOrder - b.displayOrder);
    const now = osloNow();
    state.today = now.date;
    const monday = initialWeekDate(now.date, now.weekday);
    state.week = weekDates(monday);
    state.selectedDate = now.date;
    const restored = loadSnapshot();
    render();
    if (restored) setConnection('Cached', 'pending', 'Showing last saved bookings while checking MantleDB.');
    await reloadBookings(true);
    if (Date.now() >= rateLimitUntil) await refreshGreenDeeds();
  } catch (error) {
    console.error(error);
    setConnection('Offline', 'offline', error.message);
    toast(error.message || 'Could not start the app');
  }
}

$('#previous-week').addEventListener('click', () => shiftWeek(-1));
$('#next-week').addEventListener('click', () => shiftWeek(1));
$('#today-week')?.addEventListener('click', goToday);
$('#driver-search').addEventListener('input', renderDrivers);
$('#clear-booking').addEventListener('click', clearParkingBooking);
$('#theme-toggle').addEventListener('click', () => applyTheme(document.body.classList.contains('light') ? 'dark' : 'light'));
document.addEventListener('click', event => {
  const greenCard = event.target.closest?.('#green-deeds');
  if (greenCard) {
    event.preventDefault();
    openDialogSafe($('#green-deeds-dialog'));
    return;
  }

  const closeButton = event.target.closest?.('#green-deeds-close');
  if (closeButton) {
    event.preventDefault();
    closeDialogSafe($('#green-deeds-dialog'));
    return;
  }

  const deedButton = event.target.closest?.('[data-green-deed]');
  if (deedButton) {
    event.preventDefault();
    addGreenDeed(deedButton.dataset.greenDeed);
  }
});

$('#green-deeds-dialog')?.addEventListener('click', event => {
  if (event.target === $('#green-deeds-dialog')) closeDialogSafe($('#green-deeds-dialog'));
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (lastConnectionError) setConnection('Reconnecting…', 'checking', lastConnectionError);
    reloadBookings(true);
  }
});
window.addEventListener('online', () => { setConnection('Reconnecting…', 'checking', 'Internet connection restored; checking shared storage.'); reloadBookings(true); });
window.addEventListener('offline', () => setConnection('Offline', 'offline', 'This device is offline.'));

function isStandaloneApp() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isAppleMobile() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function updateInstallButton() {
  const button = $('#install-app');
  if (!button) return;
  button.hidden = isStandaloneApp();
}

function showInstallHelp() {
  const help = $('#install-help');
  if (help) {
    if (isAppleMobile()) {
      help.textContent = 'iPhone / iPad: tap Share in Safari, then choose “Add to Home Screen”.';
    } else if (/Android/i.test(navigator.userAgent)) {
      help.textContent = 'Android: open the browser menu (⋮), then choose “Install app” or “Add to Home screen”.';
    } else {
      help.textContent = 'Open your browser menu and choose “Install app”, “Apps → Install”, or “Create shortcut”, depending on your browser.';
    }
  }
  const dialog = $('#install-dialog');
  if (dialog && !dialog.open) dialog.showModal();
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  updateInstallButton();
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  updateInstallButton();
  toast('App installed');
});

$('#install-app')?.addEventListener('click', async () => {
  if (isStandaloneApp()) {
    updateInstallButton();
    return;
  }

  if (!installPrompt) {
    showInstallHelp();
    return;
  }

  installPrompt.prompt();
  const choice = await installPrompt.userChoice;
  installPrompt = null;

  if (choice?.outcome === 'accepted') {
    $('#install-app').hidden = true;
  } else {
    updateInstallButton();
  }
});

$('#install-dialog-close')?.addEventListener('click', () => $('#install-dialog')?.close());
$('#install-dialog')?.addEventListener('click', event => {
  if (event.target === $('#install-dialog')) $('#install-dialog').close();
});

updateInstallButton();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { updateViaCache:'none' })
    .then(registration => registration.update())
    .catch(console.error);
}
applyTheme(localStorage.getItem('gt-parking-theme') || 'dark');
setInterval(() => { if (document.visibilityState === 'visible') reloadBookings(false); }, Math.max(1000, Number(APP_CONFIG.pollMs || 1500)));
init();
