import { ROOM_END_HOUR, ROOM_START_HOUR, hourLabel, roomAvailability, roomBookingsForDate } from './booking-utils.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

export class MeetingRoomView {
  constructor(container, { onFreeSlot, onBookingClick }) {
    this.container = container;
    this.onFreeSlot = onFreeSlot;
    this.onBookingClick = onBookingClick;
  }

  render(bookings, date, drivers) {
    const slots = roomAvailability(bookings, date);
    const reservations = roomBookingsForDate(bookings, date);
    const names = new Map(drivers.map(driver => [driver.id, driver.name]));
    const freeHours = slots.filter(slot => !slot.booking).length;
    const label = new Intl.DateTimeFormat('en-GB', { timeZone:'UTC', weekday:'long', day:'numeric', month:'short' }).format(new Date(`${date}T12:00:00Z`));

    this.container.innerHTML = `
      <div class="room-head">
        <div><p class="eyebrow">MEETING ROOM</p><h3>${esc(label)}</h3></div>
        <strong>${freeHours}/${ROOM_END_HOUR - ROOM_START_HOUR}h free</strong>
      </div>
      <div class="room-scale" aria-label="Meeting room availability from 06:00 to 18:00">
        ${slots.map(slot => {
          const booking = slot.booking;
          const name = booking ? (names.get(booking.driverId) || 'Booked') : '';
          return `<button type="button" class="room-slot ${booking ? 'booked' : 'free'}" data-room-hour="${slot.hour}" ${booking ? `data-room-key="${esc(booking.key)}"` : ''} aria-label="${hourLabel(slot.hour)} ${booking ? `booked by ${esc(name)}` : 'available'}">
            <span>${hourLabel(slot.hour)}</span>
            <i></i>
            ${booking ? `<b>${esc(name)}</b>` : '<b>Available</b>'}
          </button>`;
        }).join('')}
      </div>
      ${reservations.length ? `<button type="button" class="room-details-link" data-room-day-details>View day details</button>` : '<p class="room-all-free">All day currently available</p>'}`;

    this.container.querySelectorAll('[data-room-hour]').forEach(element => element.addEventListener('click', () => {
      const hour = Number(element.dataset.roomHour);
      const key = element.dataset.roomKey;
      if (key) this.onBookingClick?.(key, date);
      else this.onFreeSlot?.(hour, date);
    }));
    this.container.querySelector('[data-room-day-details]')?.addEventListener('click', () => this.onBookingClick?.(null, date));
  }
}
