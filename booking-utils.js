export const ROOM_START_HOUR = 6;
export const ROOM_END_HOUR = 18;

export function stableId(name) {
  return String(name)
    .replace(/[øØ]/g, 'o').replace(/[æÆ]/g, 'ae').replace(/[åÅ]/g, 'a')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function parseDrivers(text) {
  return String(text).split(/\r?\n/).map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map((name, sortOrder) => ({ name, id: stableId(name), sortOrder }));
}

export function dateFromIso(iso) { return new Date(`${iso}T12:00:00Z`); }
export function isoDate(date) { return new Date(date).toISOString().slice(0, 10); }
export function addDays(iso, days) { const d = dateFromIso(iso); d.setUTCDate(d.getUTCDate() + days); return isoDate(d); }

export function weekDates(date) {
  const value = dateFromIso(date);
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => { const day = new Date(value); day.setUTCDate(value.getUTCDate() + index); return isoDate(day); });
}

export function initialWeekDate(todayIso, weekday) {
  return weekday === 0 || weekday === 6 ? addDays(weekDates(todayIso)[0], 7) : weekDates(todayIso)[0];
}

export function monthKey(date) { return String(date).slice(0, 7); }
export function bookingKey(date, spaceId) { return `${date}__${spaceId}`; }
export function roomBookingKey(date, startHour) { return `${date}__meeting-room__${String(startHour).padStart(2, '0')}`; }
export function formatDate(date, options) { return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...options }).format(dateFromIso(date)); }
export function hourLabel(hour) { return `${String(hour).padStart(2, '0')}:00`; }

export function isoWeek(date) {
  const value = dateFromIso(date);
  value.setUTCHours(0,0,0,0);
  value.setUTCDate(value.getUTCDate() + 4 - (value.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  return Math.ceil((((value - yearStart) / 86400000) + 1) / 7);
}

export function isoWeekYear(date) {
  const value = dateFromIso(date);
  value.setUTCDate(value.getUTCDate() + 4 - (value.getUTCDay() || 7));
  return value.getUTCFullYear();
}

export function flattenSpaces(groups) {
  return (groups || []).flatMap(group => group.spaces.map(space => ({ ...space, groupId: group.id, groupName: group.name, limit: group.limit })));
}

export function bookingsForDate(bookings, date, spaces) {
  return Object.fromEntries(spaces.map(space => [space.id, bookings?.[bookingKey(date, space.id)] || null]));
}

export function roomBookingsForDate(bookings, date) {
  return Object.entries(bookings || {})
    .filter(([key, value]) => key.startsWith(`${date}__meeting-room__`) && value?.kind === 'meeting-room')
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => a.startHour - b.startHour);
}

export function roomBookingAtHour(bookings, date, hour) {
  return roomBookingsForDate(bookings, date).find(item => item.startHour <= hour && item.endHour > hour) || null;
}

export function roomAvailability(bookings, date) {
  return Array.from({ length: ROOM_END_HOUR - ROOM_START_HOUR }, (_, index) => {
    const hour = ROOM_START_HOUR + index;
    return { hour, booking: roomBookingAtHour(bookings, date, hour) };
  });
}

export function roomRangeIsFree(bookings, date, startHour, endHour, ignoreKey = null) {
  if (startHour < ROOM_START_HOUR || endHour > ROOM_END_HOUR || endHour <= startHour) return false;
  return !roomBookingsForDate(bookings, date).some(item => item.key !== ignoreKey && startHour < item.endHour && endHour > item.startHour);
}

export function duplicateAssignments(dayBookings) {
  const byDriver = new Map();
  for (const [spaceId, booking] of Object.entries(dayBookings || {})) {
    if (!booking?.driverId) continue;
    const ids = byDriver.get(booking.driverId) || [];
    ids.push(spaceId);
    byDriver.set(booking.driverId, ids);
  }
  return new Map([...byDriver].filter(([, ids]) => ids.length > 1));
}

export function duplicateSpaceIds(dayBookings) {
  return new Set([...duplicateAssignments(dayBookings).values()].flat());
}

export function groupUsage(dayBookings, group) {
  return group.spaces.reduce((n, space) => n + (dayBookings?.[space.id]?.driverId ? 1 : 0), 0);
}
