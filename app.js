import { APP_CONFIG } from './config.js';
import { ParkingBackend } from './backend-adapter.js';
import { ParkingMap } from './parking-map.js';
import { MeetingRoomView } from './meeting-room.js';
import { RoomDialogController } from './room-dialog-controller.js';
import { ScheduleView } from './schedule-view.js';
import {
  addDays, bookingKey, bookingsForDate, duplicateAssignments, flattenSpaces, formatDate, groupUsage,
  initialWeekDate, isoWeek, isoWeekYear, monthKey, parseDrivers, weekDates
} from './booking-utils.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

const state = {
  groups: [], meetingRoom: null, drivers: [], spaces: [], bookings: {}, week: [], selectedDate: '', today: '', selectedSpace: null
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
  namespace: APP_CONFIG.mantleNamespace
});

const map = new ParkingMap($('#parking-map'), {
  onSelect: openPicker,
  onDateChange: changeMapDate
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

function loadPendingWrites() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
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
    if (entry?.value == null) delete merged[key]; else merged[key] = entry.value;
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
  try {
    for (const [key, entry] of Object.entries({ ...pendingWrites })) {
      await backend.setBooking(key, entry?.value ?? null);
      clearPendingWrite(key);
    }
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
    const used = groupUsage(bookings, group);
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
}

function renderDrivers() {
  const query = $('#driver-search').value.trim().toLocaleLowerCase();
  const filtered = state.drivers.filter(driver => driver.name.toLocaleLowerCase().includes(query));
  $('#driver-list').innerHTML = filtered.length ? filtered.map(driver => `<button type="button" class="driver-option" data-driver-id="${esc(driver.id)}"><span class="avatar">${esc(driver.name.slice(0,1).toUpperCase())}</span><span><strong>${esc(driver.name)}</strong><small>Assign immediately</small></span></button>`).join('') : '<p class="empty-state">No employees found</p>';
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
  const before = state.bookings[key] || null;
  if (value) state.bookings[key] = value; else delete state.bookings[key];
  $('#picker').close();
  mutationsInFlight++;
  render();
  try {
    const result = await persistShared(key, value);
    if (result.synced) {
      setConnection('Live', 'live', 'Shared bookings are synchronized.');
      toast(value ? `${driverById(value.driverId)?.name || 'Employee'} assigned` : 'Parking space cleared');
    } else {
      setConnection('Sync pending', 'pending', `${result.error?.message || 'Shared storage unavailable'} Booking is saved on this device and will retry automatically.`);
      toast('Saved on this device · shared sync pending');
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
    let remote = {};
    try { remote = await backend.getBookings(visibleMonths()); }
    catch (error) {
      syncError = syncError || error;
      remote = state.bookings || {};
    }
    const next = applyPendingWrites(remote);
    const nextFingerprint = fingerprint(next);
    if (force || nextFingerprint !== lastFingerprint) {
      state.bookings = next;
      lastFingerprint = nextFingerprint;
      render();
    }
    if (Object.keys(pendingWrites).length) {
      setConnection('Sync pending', 'pending', `${syncError?.message || 'Shared storage unavailable.'} Local changes are queued and will retry automatically.`);
    } else if (syncError) {
      setConnection(navigator.onLine === false ? 'Offline' : 'Sync issue', 'offline', syncError.message);
    } else {
      setConnection('Live', 'live', 'Shared bookings are synchronized.');
    }
  } catch (error) {
    console.error(error);
    state.bookings = applyPendingWrites(state.bookings);
    render();
    setConnection(Object.keys(pendingWrites).length ? 'Sync pending' : (navigator.onLine === false ? 'Offline' : 'Sync issue'), Object.keys(pendingWrites).length ? 'pending' : 'offline', error.message);
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
    state.spaces = flattenSpaces(state.groups);
    const now = osloNow();
    state.today = now.date;
    const monday = initialWeekDate(now.date, now.weekday);
    state.week = weekDates(monday);
    state.selectedDate = (now.weekday === 0 || now.weekday === 6) ? monday : now.date;
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

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.error);
applyTheme(localStorage.getItem('gt-parking-theme') || 'dark');
setInterval(() => { if (document.visibilityState === 'visible') reloadBookings(false); }, Math.max(1000, Number(APP_CONFIG.pollMs || 1500)));
init();
