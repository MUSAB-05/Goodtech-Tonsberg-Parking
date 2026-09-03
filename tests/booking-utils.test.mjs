import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  addDays, bookingKey, bookingsForDate, duplicateAssignments, flattenSpaces, groupUsage,
  initialWeekDate, isoWeek, isoWeekYear, parseDrivers, stableId, weekDates
} from '../booking-utils.js';

const config = JSON.parse(await fs.readFile(new URL('../parking-config.json', import.meta.url), 'utf8'));
const spaces = flattenSpaces(config.groups);
const mg = config.groups.find(group => group.id === 'mg-basement');

function mgBookings(count, date='2026-09-03') {
  const result = {};
  mg.spaces.slice(0,count).forEach((space,index) => { result[bookingKey(date,space.id)] = { driverId:`driver-${index}` }; });
  return bookingsForDate(result,date,spaces);
}

test('stable IDs ignore ordering/case and normalize Scandinavian letters', () => {
  assert.equal(stableId(' Mustafa '), stableId('MUSTAFA'));
  assert.equal(stableId('Søren Ås'), 'soren-as');
});

test('driver parser ignores comments and empty lines', () => {
  assert.deepEqual(parseDrivers('# comment\n\nMustafa\nKevin\n').map(x=>x.name), ['Mustafa','Kevin']);
});

test('requested parking spaces exist', () => {
  assert.deepEqual(spaces.map(s=>s.name), ['F18 Øvreplan 1','F18 Øvreplan 2','F18 Nedreplan','MG 50','MG 51','MG 52','MG 53','MG 54','MG 69']);
});

for (const count of [0,1,2,3,6]) {
  test(`MG usage ${count} follows normal allocation warning rule`, () => {
    const used = groupUsage(mgBookings(count),mg);
    assert.equal(used,count);
    assert.equal(used > mg.limit,count > 2);
  });
}

test('duplicates are detected only within the same day', () => {
  const date='2026-09-03';
  const bookings={
    [bookingKey(date,'mg-50')]:{driverId:'mustafa'},
    [bookingKey(date,'f18-ovreplan-1')]:{driverId:'mustafa'},
    [bookingKey(date,'mg-51')]:{driverId:'kevin'},
    [bookingKey('2026-09-04','mg-52')]:{driverId:'kevin'}
  };
  const dup=duplicateAssignments(bookingsForDate(bookings,date,spaces));
  assert.deepEqual(dup.get('mustafa').sort(),['f18-ovreplan-1','mg-50']);
  assert.equal(dup.has('kevin'),false);
});

test('week always contains Monday through Sunday', () => {
  const dates=weekDates('2026-09-03');
  assert.deepEqual([dates[0],dates[6]],['2026-08-31','2026-09-06']);
});

test('week navigation crosses year boundary', () => {
  assert.equal(addDays('2026-12-28',7),'2027-01-04');
  assert.equal(isoWeek('2026-12-28'),53);
  assert.equal(isoWeekYear('2026-12-28'),2026);
  assert.equal(isoWeek('2027-01-04'),1);
  assert.equal(isoWeekYear('2027-01-04'),2027);
});

test('weekend opening advances to upcoming week', () => {
  assert.equal(initialWeekDate('2026-09-05',6),'2026-09-07');
  assert.equal(initialWeekDate('2026-09-06',0),'2026-09-07');
  assert.equal(initialWeekDate('2026-09-03',4),'2026-08-31');
});

test('parking config can add a new space without code changes', () => {
  const copy=structuredClone(config);
  copy.groups.find(g=>g.id==='mg-basement').spaces.push({id:'mg-70',name:'MG 70'});
  assert.equal(flattenSpaces(copy.groups).some(s=>s.id==='mg-70'),true);
});
