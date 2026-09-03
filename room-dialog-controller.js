import {
  ROOM_END_HOUR, ROOM_START_HOUR, formatDate, hourLabel, roomAvailability,
  roomBookingKey, roomBookingsForDate, roomRangeIsFree
} from './booking-utils.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

export class RoomDialogController {
  constructor({ state, backend, driverById, selectDate, render, setConnection, toast, reloadBookings, beginMutation, endMutation }) {
    Object.assign(this, { state, backend, driverById, selectDate, render, setConnection, toast, reloadBookings, beginMutation, endMutation });
  }

  shell(title, body) {
    $('#room-dialog-content').innerHTML = `<div class="room-dialog-inner"><div class="picker-head"><div><p class="eyebrow">MEETING ROOM</p><h2>${esc(title)}</h2></div><button class="icon-button" type="button" data-room-close aria-label="Close">×</button></div>${body}</div>`;
    $('#room-dialog-content').querySelector('[data-room-close]')?.addEventListener('click', () => $('#room-dialog').close());
    if (!$('#room-dialog').open) $('#room-dialog').showModal();
  }

  openBooking(startHour, date) {
    this.selectDate(date);
    const initialEnd = Math.min(Number(startHour) + 1, ROOM_END_HOUR);
    const title = `${formatDate(date, { weekday:'short', day:'numeric', month:'short' })} · Book room`;
    const startOptions = Array.from({length: ROOM_END_HOUR - ROOM_START_HOUR}, (_,i) => ROOM_START_HOUR + i)
      .map(hour => `<option value="${hour}" ${hour === Number(startHour) ? 'selected' : ''}>${hourLabel(hour)}</option>`).join('');
    this.shell(title, `<div class="room-booking-form"><div class="room-time-fields"><label>Start<select id="room-start">${startOptions}</select></label><label>End<select id="room-end"></select></label></div><p class="room-form-note">Minimum 1 hour · available between 06:00 and 18:00</p><input id="room-driver-search" type="search" placeholder="Search employee" autocomplete="off"><div id="room-driver-list" class="driver-list"></div></div>`);

    const start = $('#room-start');
    const end = $('#room-end');
    const updateEnds = (preferred = null) => {
      const startValue = Number(start.value);
      end.innerHTML = Array.from({length: ROOM_END_HOUR - startValue}, (_,i) => startValue + i + 1)
        .map(hour => `<option value="${hour}" ${(preferred ?? initialEnd) === hour ? 'selected' : ''}>${hourLabel(hour)}</option>`).join('');
    };
    updateEnds(initialEnd);
    start.addEventListener('change', () => updateEnds(Number(start.value) + 1));

    const renderDrivers = () => {
      const query = $('#room-driver-search').value.trim().toLocaleLowerCase();
      const filtered = this.state.drivers.filter(driver => driver.name.toLocaleLowerCase().includes(query));
      $('#room-driver-list').innerHTML = filtered.length ? filtered.map(driver => `<button type="button" class="driver-option" data-room-driver="${esc(driver.id)}"><span class="avatar">${esc(driver.name.slice(0,1).toUpperCase())}</span><span><strong>${esc(driver.name)}</strong><small>Book selected time</small></span></button>`).join('') : '<p class="empty-state">No employees found</p>';
      $('#room-driver-list').querySelectorAll('[data-room-driver]').forEach(element => element.addEventListener('click', () => this.save(element.dataset.roomDriver, date, Number(start.value), Number(end.value))));
    };
    $('#room-driver-search').addEventListener('input', renderDrivers);
    renderDrivers();
  }

  openDetails(key, date) {
    this.selectDate(date);
    const reservations = roomBookingsForDate(this.state.bookings, date);
    const reservation = key ? reservations.find(item => item.key === key) : null;
    const title = reservation ? `${hourLabel(reservation.startHour)}–${hourLabel(reservation.endHour)}` : formatDate(date, { weekday:'long', day:'numeric', month:'long' });
    if (reservation) {
      const driver = this.driverById(reservation.driverId);
      this.shell(title, `<div class="room-reservation-detail"><span class="room-detail-status">Booked</span><h3>${esc(driver?.name || 'Unknown employee')}</h3><p>${hourLabel(reservation.startHour)}–${hourLabel(reservation.endHour)} · ${reservation.endHour - reservation.startHour} hour${reservation.endHour - reservation.startHour === 1 ? '' : 's'}</p><button type="button" class="clear-button" data-room-remove>Remove booking</button></div>`);
      $('[data-room-remove]')?.addEventListener('click', () => this.clear(reservation.key));
      return;
    }
    const firstFree = roomAvailability(this.state.bookings, date).find(slot => !slot.booking)?.hour;
    const list = reservations.length ? reservations.map(item => {
      const driver = this.driverById(item.driverId);
      return `<button type="button" class="room-day-booking" data-room-detail-key="${esc(item.key)}"><span><strong>${hourLabel(item.startHour)}–${hourLabel(item.endHour)}</strong><small>${item.endHour - item.startHour}h</small></span><b>${esc(driver?.name || 'Unknown employee')}</b></button>`;
    }).join('') : '<p class="empty-state room-empty-day">No bookings. The room is free all day.</p>';
    this.shell(title, `<div class="room-day-list">${list}</div>${firstFree != null ? '<button type="button" class="compact-button room-book-action" data-room-book-free>＋ Book a time</button>' : '<p class="room-full-day">The room is fully booked.</p>'}`);
    $('#room-dialog-content').querySelectorAll('[data-room-detail-key]').forEach(element => element.addEventListener('click', () => this.openDetails(element.dataset.roomDetailKey, date)));
    $('[data-room-book-free]')?.addEventListener('click', () => { $('#room-dialog').close(); this.openBooking(firstFree, date); });
  }

  async save(driverId, date, startHour, endHour) {
    if (!roomRangeIsFree(this.state.bookings, date, startHour, endHour)) return this.toast('That time overlaps an existing meeting-room booking.');
    const key = roomBookingKey(date, startHour);
    const value = { kind:'meeting-room', driverId, startHour, endHour, updatedAt:new Date().toISOString() };
    this.state.bookings[key] = value;
    $('#room-dialog').close();
    this.beginMutation();
    this.render();
    try {
      await this.backend.setBooking(key, value);
      this.setConnection('Live', 'live', 'Shared bookings are synchronized.');
      this.toast(`Meeting room booked ${hourLabel(startHour)}–${hourLabel(endHour)}`);
    } catch (error) {
      delete this.state.bookings[key];
      this.render();
      this.setConnection('Sync issue', 'offline', error.message);
      this.toast(error.message || 'Could not book meeting room');
    } finally {
      this.endMutation();
      await this.reloadBookings(true);
    }
  }

  async clear(key) {
    const before = this.state.bookings[key];
    if (!before) return;
    delete this.state.bookings[key];
    $('#room-dialog').close();
    this.beginMutation();
    this.render();
    try {
      await this.backend.setBooking(key, null);
      this.setConnection('Live', 'live', 'Shared bookings are synchronized.');
      this.toast('Meeting-room booking removed');
    } catch (error) {
      this.state.bookings[key] = before;
      this.render();
      this.setConnection('Sync issue', 'offline', error.message);
      this.toast(error.message || 'Could not remove meeting-room booking');
    } finally {
      this.endMutation();
      await this.reloadBookings(true);
    }
  }
}
