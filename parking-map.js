import { groupUsage } from './booking-utils.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

export class ParkingMap {
  constructor(container, { onSelect, onDateChange }) {
    this.container = container;
    this.onSelect = onSelect;
    this.onDateChange = onDateChange;
  }

  render(groups, bookings, date, drivers, duplicateMap) {
    const label = new Intl.DateTimeFormat('en-GB', { timeZone:'UTC', weekday:'long', day:'numeric', month:'long' }).format(new Date(`${date}T12:00:00Z`));
    const mg = groups.find(group => group.id === 'mg-basement');
    const mgWarning = mg && groupUsage(bookings, mg) > mg.limit;
    this.container.innerHTML = `
      <div class="map-heading">
        <button class="icon-button" data-map-date="prev" aria-label="Previous map date">‹</button>
        <strong>${esc(label)}</strong>
        <button class="icon-button" data-map-date="next" aria-label="Next map date">›</button>
      </div>
      <div class="parking-map">
        ${this.mgMarkup(groups, bookings, drivers, duplicateMap, mgWarning)}
        ${this.simpleGroupMarkup(groups, 'f18-nedreplan', bookings, drivers, duplicateMap)}
        ${this.simpleGroupMarkup(groups, 'f18-ovreplan', bookings, drivers, duplicateMap)}
      </div>`;

    this.container.querySelectorAll('[data-space-id]').forEach(element => element.addEventListener('click', () => this.onSelect(element.dataset.spaceId, date)));
    this.container.querySelector('[data-map-date="prev"]').addEventListener('click', () => this.onDateChange(date, -1));
    this.container.querySelector('[data-map-date="next"]').addEventListener('click', () => this.onDateChange(date, 1));
  }

  spotMarkup(space, bookings, drivers, duplicateMap, mgWarning = false) {
    const booking = bookings[space.id];
    const driver = drivers.find(item => item.id === booking?.driverId);
    const duplicate = Boolean(booking?.driverId && duplicateMap.has(booking.driverId));
    const warning = Boolean(mgWarning && booking?.driverId);
    return `<button class="map-space ${booking ? 'occupied' : ''} ${duplicate ? 'duplicate' : ''} ${warning ? 'mg-warning' : ''}" data-space-id="${esc(space.id)}">
      <span>${esc(space.name)}</span>
      <b>${esc(driver?.name || 'Empty')}</b>
      ${warning ? '<small>⚠ MG allocation over 2</small>' : duplicate ? '<small>⚠ Duplicate booking</small>' : '<small>Tap to assign</small>'}
    </button>`;
  }

  mgMarkup(groups, bookings, drivers, duplicateMap, warning) {
    const group = groups.find(item => item.id === 'mg-basement');
    if (!group) return '';
    const byId = new Map(group.spaces.map(space => [space.id, space]));
    const rightIds = ['mg-50','mg-51','mg-52','mg-53','mg-54'];
    return `<section class="map-group map-mg-basement ${warning ? 'group-warning' : ''}">
      <div class="map-group-title"><span>${esc(group.name)}</span>${warning ? '<em>⚠ extra MG usage</em>' : `<em>${groupUsage(bookings, group)}/${group.limit} normal allocation</em>`}</div>
      <div class="mg-layout">
        <div class="mg-outline" aria-hidden="true"></div>
        <div class="mg-right-stack">${rightIds.map(id => byId.get(id) ? this.spotMarkup(byId.get(id), bookings, drivers, duplicateMap, warning) : '').join('')}</div>
        <div class="mg-69-pocket">${byId.get('mg-69') ? this.spotMarkup(byId.get('mg-69'), bookings, drivers, duplicateMap, warning) : ''}</div>
      </div>
    </section>`;
  }

  simpleGroupMarkup(groups, groupId, bookings, drivers, duplicateMap) {
    const group = groups.find(item => item.id === groupId);
    if (!group) return '';
    return `<section class="map-group map-${esc(groupId)}"><div class="map-group-title"><span>${esc(group.name)}</span><em>${groupUsage(bookings, group)}/${group.limit} used</em></div><div class="map-spaces">${group.spaces.map(space => this.spotMarkup(space, bookings, drivers, duplicateMap)).join('')}</div></section>`;
  }
}
