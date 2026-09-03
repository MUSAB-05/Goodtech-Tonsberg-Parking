import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const read=path=>fs.readFile(new URL(`../${path}`,import.meta.url),'utf8');
const readCss=async()=>['styles/base.css','styles/overview.css','styles/schedule.css','styles/dialogs.css','styles/responsive.css'].reduce(async(acc,p)=>(await acc)+(await read(p)),Promise.resolve(''));

test('PWA files, Goodtech logo and install metadata are present', async()=>{
  const [html,manifest,sw]=await Promise.all([read('index.html'),read('manifest.webmanifest'),read('sw.js')]);
  assert.match(html,/manifest\.webmanifest/); assert.match(html,/install-app/); assert.match(html,/goodtech-logo\.webp/); assert.match(html,/sync-diagnostics\.js/);
  const parsed=JSON.parse(manifest); assert.equal(parsed.short_name,'GT Parking'); assert.equal(parsed.display,'standalone'); assert.equal(parsed.scope,'./');
  assert.match(sw,/gt-parking-shell-v8-/); assert.match(sw,/cache:'no-store'/); assert.match(sw,/client\.navigate/); assert.match(sw,/sync-diagnostics\.js/); assert.match(sw,/meeting-room\.js/); assert.match(sw,/goodtech-logo\.webp/); assert.match(sw,/schedule-view\.js/); assert.match(sw,/room-dialog-controller\.js/);
});

test('mobile layout uses safe gutters, selected-day view and no page overflow', async()=>{
  const [css,schedule]=await Promise.all([readCss(),read('schedule-view.js')]);
  assert.match(css,/@media\(max-width:390px\)/); assert.match(css,/calc\(100% - 16px\)/); assert.match(css,/html\{overflow-x:hidden/);
  assert.match(css,/mobile-day-strip\{display:flex/); assert.match(css,/schedule-cell:not\(\.selected\)/); assert.match(schedule,/mobile-day-chip/); assert.match(schedule,/selected \? 'selected'/);
});

test('map uses roomy MG layout, charger, full-size MG69 and swapped F18 ordering', async()=>{
  const [map,css]=await Promise.all([read('parking-map.js'),read('styles/overview.css')]);
  const upper=map.indexOf("'f18-ovreplan'"); const lower=map.indexOf("'f18-nedreplan'");
  assert.match(map,/mg-50','mg-51','mg-52','mg-53','mg-54'/); assert.match(map,/mg-69/); assert.match(map,/charger/); assert.ok(upper < lower);
  assert.match(css,/mg-69-pocket\{[^}]*grid-row:2/); assert.match(css,/mg-69-pocket \.map-space\{width:100%;height:100%/); assert.match(css,/min-height:58px/); assert.match(css,/font-size:15px/);
});

test('MG remaining spaces switch to warning color as soon as normal allocation is full', async()=>{
  const [map,schedule]=await Promise.all([read('parking-map.js'),read('schedule-view.js')]);
  assert.match(map,/mgUsed >= mg\.limit/); assert.match(schedule,/groupUsage\(this\.dayBookings\(date\), mgGroup\) >= mgGroup\.limit/);
});

test('schedule grid has strong separators, row variation and larger readable text', async()=>{
  const css=await read('styles/schedule.css');
  assert.match(css,/border-right:2px solid/); assert.match(css,/border-bottom:2px solid/); assert.match(css,/font-size:1rem/); assert.match(css,/min-height:72px/); assert.match(css,/nth-child\(odd\)/);
});

test('status colors and no Empty parking labels are implemented', async()=>{
  const [css,map,app]=await Promise.all([readCss(),read('parking-map.js'),read('app.js')]);
  assert.match(css,/map-space\.available/); assert.match(css,/map-space\.occupied/); assert.match(css,/mg-over-free/);
  assert.doesNotMatch(map,/driver\?\.name \|\| 'Empty'/); assert.doesNotMatch(app,/>Empty</);
});

test('meeting room has daily 06-18 view and weekly availability row', async()=>{
  const [room,controller,schedule,html]=await Promise.all([read('meeting-room.js'),read('room-dialog-controller.js'),read('schedule-view.js'),read('index.html')]);
  assert.match(schedule,/room-week-bar/); assert.match(controller,/roomBookingKey/); assert.match(controller,/openDetails/);
  assert.match(room,/roomAvailability/); assert.match(html,/meeting-room/); assert.match(html,/room-dialog/);
});

test('app includes claimed shared storage, live polling, weekend focus and no login', async()=>{
  const [app,schedule,html,config,backend]=await Promise.all([read('app.js'),read('schedule-view.js'),read('index.html'),read('config.js'),read('backend-adapter.js')]);
  assert.match(app,/APP_CONFIG\.pollMs/); assert.match(app,/initialWeekDate/); assert.match(app,/key: APP_CONFIG\.mantleKey/); assert.match(schedule,/Already has/); assert.match(schedule,/TODAY/); assert.match(app,/Sync issue/);
  assert.match(config,/mantleKey:/); assert.match(backend,/X-Mantle-Key/); assert.doesNotMatch(html,/password/i); assert.doesNotMatch(html,/login/i);
});

test('sync diagnostics tests browser reachability, authenticated API and queued writes', async()=>{
  const [diag,css]=await Promise.all([read('sync-diagnostics.js'),read('styles/dialogs.css')]);
  assert.match(diag,/mode: 'no-cors'/); assert.match(diag,/backend\.healthCheck/); assert.match(diag,/backend\.setBookings/); assert.match(diag,/Queue reconciliation/); assert.match(css,/diagnostics-output/);
});

test('robots discourages indexing', async()=>{ assert.match(await read('robots.txt'),/Disallow: \//); });
