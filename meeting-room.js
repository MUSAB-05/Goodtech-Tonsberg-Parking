export const ROOM_START_HOUR = 6;
export const ROOM_END_HOUR = 18;

export function roomBookingKey(date) {
  return `room__${date}`;
}

export function normalizeRoomBookings(value) {
  return Array.isArray(value) ? value.filter(Boolean).map(item => ({
    ...item,
    startHour: Number(item.startHour),
    endHour: Number(item.endHour)
  })).sort((a,b) => a.startHour - b.startHour) : [];
}

export function validateRoomHours(startHour, endHour) {
  const start = Number(startHour);
  const end = Number(endHour);
  return Number.isInteger(start) && Number.isInteger(end) && start >= ROOM_START_HOUR && end <= ROOM_END_HOUR && end - start >= 1;
}

export function roomOverlap(bookings, startHour, endHour, ignoreId = null) {
  const start = Number(startHour);
  const end = Number(endHour);
  return normalizeRoomBookings(bookings).some(item => item.id !== ignoreId && start < item.endHour && end > item.startHour);
}

export function hourlyRoomSlots(bookings) {
  const normalized = normalizeRoomBookings(bookings);
  return Array.from({ length: ROOM_END_HOUR - ROOM_START_HOUR }, (_, index) => {
    const hour = ROOM_START_HOUR + index;
    const booking = normalized.find(item => hour >= item.startHour && hour < item.endHour) || null;
    return { hour, booking, available: !booking };
  });
}

export function roomUsageHours(bookings) {
  return normalizeRoomBookings(bookings).reduce((sum, item) => sum + Math.max(0, item.endHour - item.startHour), 0);
}

export function roomAvailabilityRatio(bookings) {
  const total = ROOM_END_HOUR - ROOM_START_HOUR;
  return Math.max(0, total - roomUsageHours(bookings)) / total;
}
