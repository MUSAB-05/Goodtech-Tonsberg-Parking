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
  spaceFrequency: {}
};
let refreshInFlight = false;
let mutationsInFlight = 0;
let lastFingerprint = '';
let installPrompt = null;
let lastConnectionError = '';
const PENDING_KEY = 'gt-parking-pending-v1';
let pendingWrites = loadPendingWrites();
let pendingFlushInFlight = false;

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
  openRoomDetails: (key, date) => roomController.openDetails(key, date)
});

function osloNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_CONFIG.timezone || 'Europe/Oslo', year:'numeric', month:'2-digit', day:'2-digit'
  }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type)?.value;
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  return { date, weekday: new Date(`${date}T12:00:00Z`).getUTCDay() };
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
  if (!match || match[2].startsWith('meeting-room__')) return null;
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
  scheduleView.render();
  map.render(state.groups, bookings, state.selectedDate, state.drivers, duplicates);
  roomView.render(state.bookings, state.selectedDate, state.drivers);
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
    const count = counts.get(driver.id) || 0;
    const hint = count ? `${count} previous booking${count === 1 ? '' : 's'} here` : 'Assign immediately';
    return `<button type="button" class="driver-option" data-driver-id="${esc(driver.id)}"><span class="avatar">${esc(driver.name.slice(0,1).toUpperCase())}</span><span><strong>${esc(driver.name)}</strong><small>${esc(hint)}</small></span></button>`;
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
  refreshInFlight = true;
  let syncError = null;
  try {
    if (Object.keys(pendingWrites).length) {
      try { await flushPendingWrites(); }
      catch (error) { syncError = error; }
    }
    const months = visibleMonths();
    let nextBase = state.bookings || {};
    try {
      const remote = await backend.getBookings(months);
      nextBase = mergeVisibleMonths(state.bookings, remote, months);
    } catch (error) {
      syncError = syncError || error;
    }
    const next = applyPendingWrites(nextBase);
    const nextFingerprint = fingerprint(next);
    if (force || nextFingerprint !== lastFingerprint) {
      state.bookings = next;
      lastFingerprint = nextFingerprint;
      render();
    }
    const pendingCount = Object.keys(pendingWrites).length;
    if (pendingCount) {
      setConnection(`Sync pending (${pendingCount})`, 'pending', `${syncError?.message || 'Shared storage unavailable.'} ${pendingCount} local change${pendingCount === 1 ? '' : 's'} queued for retry.`);
    } else if (syncError) {
      setConnection(navigator.onLine === false ? 'Offline' : 'Sync issue', 'offline', syncError.message);
    } else {
      setConnection('Live', 'live', 'Shared bookings are synchronized.');
    }
  } catch (error) {
    console.error(error);
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
    render();
    await reloadBookings(true);
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

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (lastConnectionError) setConnection('Reconnecting…', 'checking', lastConnectionError);
    reloadBookings(true);
  }
});
window.addEventListener('online', () => { setConnection('Reconnecting…', 'checking', 'Internet connection restored; checking shared storage.'); reloadBookings(true); });
window.addEventListener('offline', () => setConnection('Offline', 'offline', 'This device is offline.'));

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  $('#install-app').hidden = false;
});
$('#install-app').addEventListener('click', async () => {
  if (!installPrompt) return toast('Use your browser menu → Install app / Add to Home Screen.');
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('#install-app').hidden = true;
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { updateViaCache:'none' })
    .then(registration => registration.update())
    .catch(console.error);
}
applyTheme(localStorage.getItem('gt-parking-theme') || 'dark');
setInterval(() => { if (document.visibilityState === 'visible') reloadBookings(false); }, Math.max(1000, Number(APP_CONFIG.pollMs || 1500)));
init();
