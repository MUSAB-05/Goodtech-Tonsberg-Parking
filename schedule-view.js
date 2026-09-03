import { bookingKey, formatDate, groupUsage, roomAvailability } from './booking-utils.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

export class ScheduleView {
  constructor(container, { state, dayBookings, duplicatesFor, openPicker, selectDate, openRoomDetails }) {
    Object.assign(this, { container, state, dayBookings, duplicatesFor, openPicker, selectDate, openRoomDetails });
  }

  driverById(id) { return this.state.drivers.find(driver => driver.id === id); }
  spaceById(id) { return this.state.spaces.find(space => space.id === id); }

  duplicateMessage(date, spaceId, driverId) {
    const ids = this.duplicatesFor(date).get(driverId) || [];
    const other = ids.find(id => id !== spaceId);
    return other ? `⚠ Already has ${this.spaceById(other)?.name || other}` : '';
  }

  roomWeekBar(date) {
    const availability = roomAvailability(this.state.bookings, date);
    const bookedHours = availability.filter(slot => slot.booking).length;
    return `<span class="room-week-bar" aria-hidden="true">${availability.map(slot => `<i class="${slot.booking ? 'booked' : 'free'}"></i>`).join('')}</span><span class="sr-only">${bookedHours} of 12 hours booked</span>`;
  }

  render() {
    const head = this.state.week.map(date => {
      const today = date === this.state.today;
      const selected = date === this.state.selectedDate;
      return `<button class="day-head ${selected ? 'selected' : ''} ${today ? 'today' : ''}" data-date="${date}"><span>${esc(formatDate(date, { weekday:'short' }))}${today ? ' · TODAY' : ''}</span><b>${esc(formatDate(date, { day:'numeric', month:'short' }))}</b></button>`;
    }).join('');

    const rows = this.state.spaces.map(space => {
      const cells = this.state.week.map(date => {
        const booking = this.state.bookings[bookingKey(date, space.id)];
        const driver = this.driverById(booking?.driverId);
        const duplicate = Boolean(booking?.driverId && this.duplicatesFor(date).has(booking.driverId));
        const mgGroup = this.state.groups.find(group => group.id === 'mg-basement');
        const mgOver = space.groupId === 'mg-basement' && groupUsage(this.dayBookings(date), mgGroup) > mgGroup.limit;
        const classes = [booking ? 'occupied' : 'available', duplicate ? 'duplicate' : '', mgOver && !booking ? 'mg-over-free' : '', date === this.state.today ? 'today' : ''].filter(Boolean).join(' ');
        const warning = duplicate ? this.duplicateMessage(date, space.id, booking.driverId) : '';
        return `<button class="schedule-cell ${classes}" data-space-id="${esc(space.id)}" data-date="${date}" aria-label="${esc(space.name)}, ${esc(formatDate(date,{weekday:'long',day:'numeric',month:'long'}))}, ${driver ? `booked by ${esc(driver.name)}` : 'available'}">${driver ? `<span>${esc(driver.name)}</span>` : ''}${warning ? `<small>${esc(warning)}</small>` : ''}</button>`;
      }).join('');
      const charger = space.charger ? '<span class="row-charger" title="EV charger">⚡</span>' : '';
      return `<div class="schedule-row"><div class="space-name"><small>${esc(space.groupName)}</small><strong>${esc(space.name)} ${charger}</strong></div>${cells}</div>`;
    }).join('');

    const roomRow = `<div class="schedule-row meeting-room-row"><div class="space-name"><small>BOOKABLE</small><strong>Meeting room</strong></div>${this.state.week.map(date => `<button class="room-week-cell ${date === this.state.today ? 'today' : ''}" data-room-day="${date}" aria-label="Meeting room ${esc(formatDate(date,{weekday:'long',day:'numeric',month:'long'}))}">${this.roomWeekBar(date)}</button>`).join('')}</div>`;
    this.container.innerHTML = `<div class="schedule-grid" style="--days:7"><div class="schedule-row schedule-head"><div class="space-name">Parking / room</div>${head}</div>${rows}${roomRow}</div>`;
    this.container.querySelectorAll('.day-head[data-date]').forEach(el => el.addEventListener('click', () => this.selectDate(el.dataset.date)));
    this.container.querySelectorAll('[data-space-id]').forEach(el => el.addEventListener('click', () => this.openPicker(el.dataset.spaceId, el.dataset.date)));
    this.container.querySelectorAll('[data-room-day]').forEach(el => el.addEventListener('click', () => this.openRoomDetails(null, el.dataset.roomDay)));
  }
}
