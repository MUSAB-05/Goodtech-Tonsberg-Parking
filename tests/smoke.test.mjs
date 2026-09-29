import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const read=path=>fs.readFile(new URL(`../${path}`,import.meta.url),'utf8');
const readCss=async()=>['styles/base.css','styles/overview.css','styles/schedule.css','styles/dialogs.css','styles/responsive.css','styles/access.css'].reduce(async(acc,p)=>(await acc)+(await read(p)),Promise.resolve(''));

test('PWA files, Goodtech logo, install metadata and access gate are present', async()=>{
  const [html,manifest,sw,gate]=await Promise.all([read('index.html'),read('manifest.webmanifest'),read('sw.js'),read('access-gate.js')]);
  assert.match(html,/manifest\.webmanifest/); assert.match(html,/install-app/); assert.match(html,/goodtech-logo\.webp/); assert.match(html,/id="access-gate"/); assert.match(html,/access-gate\.js/);
  const parsed=JSON.parse(manifest); assert.equal(parsed.short_name,'GT Parking'); assert.equal(parsed.display,'standalone'); assert.equal(parsed.scope,'./');
  assert.match(sw,/gt-parking-shell-v11-/); assert.match(sw,/cache:'no-store'/); assert.match(sw,/client\.navigate/); assert.match(sw,/access-gate\.js/); assert.match(sw,/styles\/access\.css/); assert.match(sw,/meeting-room\.js/); assert.match(sw,/goodtech-logo\.webp/); assert.match(sw,/schedule-view\.js/); assert.match(sw,/room-dialog-controller\.js/);
  assert.match(gate,/EXPECTED_HASH/); assert.match(gate,/sessionStorage/); assert.match(gate,/import\('\.\/app\.js'\)/); assert.doesNotMatch(gate,/['"]3111['"]/);
});

test('phone layout keeps the top overview compact and hides the weekly schedule', async()=>{
  const css=await readCss();
  assert.match(css,/@media\(max-width:390px\)/); assert.match(css,/calc\(100% - 14px\)/); assert.match(css,/html\{overflow-x:hidden/);
  assert.match(css,/@media\(max-width:700px\)[\s\S]*?\.schedule-panel\{display:none!important\}/);
  assert.match(css,/summary-item:nth-child\(3\)\{grid-column:1\/-1\}/);
  assert.match(css,/grid-template-rows:repeat\(5,46px\)/);
});

test('desktop schedule has no extra mobile day strip', async()=>{
  const [schedule,css]=await Promise.all([read('schedule-view.js'),read('styles/schedule.css')]);
  assert.doesNotMatch(schedule,/mobile-day-chip/);
  assert.doesNotMatch(schedule,/mobile-day-strip/);
  assert.match(css,/mobile-day-strip\{display:none!important\}/);
});

test('Today shortcuts exist for map and weekly navigation', async()=>{
  const [html,map,app]=await Promise.all([read('index.html'),read('parking-map.js'),read('app.js')]);
  assert.match(html,/id="today-week"/); assert.match(map,/data-map-date="today"/); assert.match(app,/function goToday\(\)/); assert.match(app,/state\.selectedDate = now\.date/);
});

test('map uses stable MG order, charger, full-size MG69 and swapped F18 ordering', async()=>{
  const [map,css]=await Promise.all([read('parking-map.js'),read('styles/overview.css')]);
  const upper=map.indexOf("'f18-ovreplan'"); const lower=map.indexOf("'f18-nedreplan'");
  assert.match(map,/mg-50','mg-51','mg-52','mg-53','mg-54'/); assert.match(map,/mg-69/); assert.match(map,/Explicit slot order/); assert.match(map,/charger/); assert.ok(upper < lower);
  assert.match(css,/mg-right-stack>\.map-space:nth-child\(5\)/); assert.match(css,/mg-69-pocket\{[^}]*grid-row:2/); assert.match(css,/mg-69-pocket \.map-space\{width:100%;height:100%/);
});

test('MG guest bookings do not consume normal allocation or trigger yellow state', async()=>{
  const [map,schedule,app]=await Promise.all([read('parking-map.js'),read('schedule-view.js'),read('app.js')]);
  assert.match(map,/normalAllocationUsage/); assert.match(schedule,/normalAllocationUsage/); assert.match(app,/normalAllocationUsage/);
});

test('parking claims cannot overwrite an occupied place and use a simple busy message', async()=>{
  const [app,backend]=await Promise.all([read('app.js'),read('backend-adapter.js')]);
  assert.match(app,/current\?\.driverId\) return toast\('Place is busy\.'\)/);
  assert.match(app,/backend\.claimBooking/); assert.match(backend,/busyError/); assert.match(backend,/Place is busy\./);
});

test('parking name picker ranks drivers using per-space booking frequency', async()=>{
  const [app,backend]=await Promise.all([read('app.js'),read('backend-adapter.js')]);
  assert.match(app,/loadSpaceFrequency/); assert.match(app,/counts\.get\(b\.id\)/); assert.doesNotMatch(app,/previous booking/); assert.match(backend,/getSpaceFrequency/); assert.match(backend,/setSpaceFrequency/);
});

test('history keepalive follows the live Mantle config instead of a stale namespace', async()=>{
  const workflow=await read('.github/workflows/mantle-keepalive.yml');
  assert.match(workflow,/import \{ APP_CONFIG \} from '\.\/config\.js'/); assert.match(workflow,/X-Mantle-Key/); assert.match(workflow,/MANTLE_NAMESPACE/); assert.doesNotMatch(workflow,/gt-parking-musab-20260903-v3/);
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

test('app keeps the existing shared storage and live polling behind the access gate', async()=>{
  const [app,schedule,config,backend,gate]=await Promise.all([read('app.js'),read('schedule-view.js'),read('config.js'),read('backend-adapter.js'),read('access-gate.js')]);
  assert.match(app,/APP_CONFIG\.pollMs/); assert.match(app,/initialWeekDate/); assert.match(app,/key: APP_CONFIG\.mantleKey/); assert.match(schedule,/Already has/); assert.match(schedule,/TODAY/); assert.match(app,/Sync issue/);
  assert.match(config,/mantleKey:/); assert.match(backend,/X-Mantle-Key/); assert.match(gate,/access code|EXPECTED_HASH/i);
});

test('sync diagnostics tests browser reachability, authenticated API and queued writes', async()=>{
  const [diag,css]=await Promise.all([read('sync-diagnostics.js'),read('styles/dialogs.css')]);
  assert.match(diag,/mode: 'no-cors'/); assert.match(diag,/backend\.healthCheck/); assert.match(diag,/backend\.setBookings/); assert.match(diag,/Queue reconciliation/); assert.match(css,/diagnostics-output/);
});

test('robots discourages indexing', async()=>{ assert.match(await read('robots.txt'),/Disallow: \//); });


test('install button has a reliable mobile fallback when native prompt is unavailable', async()=>{
  const [html,app]=await Promise.all([read('index.html'),read('app.js')]);
  assert.match(html,/id="install-app"[^>]*>＋ App<\/button>/);
  assert.match(html,/id="install-dialog"/);
  assert.match(app,/beforeinstallprompt/);
  assert.match(app,/showInstallHelp/);
  assert.match(app,/Add to Home Screen/);
  assert.match(app,/appinstalled/);
  assert.match(app,/isStandaloneApp/);
});


test('lønningspils voting is shown above parking and confirms at four people for 17:00 without exposing threshold counts', async()=>{
  const [html,app,schedule,css]=await Promise.all([read('index.html'),read('app.js'),read('schedule-view.js'),read('styles/schedule.css')]);
  assert.match(html,/id="payday-dialog"/); assert.match(html,/id="payday-mobile"/);
  assert.match(schedule,/Lønningspils/); assert.match(schedule,/paydayRow/); assert.match(schedule,/PAYDAY_THRESHOLD = 4/); assert.match(schedule,/'Vote'/); assert.match(schedule,/count > 0 \? \`<i class="payday-vote-count"/); assert.doesNotMatch(schedule,/3 personer|\/\$\{PAYDAY_THRESHOLD\}/);
  assert.match(app,/PAYDAY_THRESHOLD = 4/); assert.match(app,/startHour: 17/); assert.match(app,/togglePaydayVote/); assert.match(app,/driver\.id !== 'guest'/); assert.match(app,/'Vote'/); assert.match(app,/status\.count > 0 \? \`<i class="payday-vote-count"/); assert.doesNotMatch(app,/3 personer|trenger \$\{PAYDAY_THRESHOLD/);
  assert.match(css,/payday-cell\.confirmed/); assert.match(css,/payday-mobile/); assert.match(css,/\.payday-vote-count\{position:absolute/);
});


test('payday dialog has compact dedicated layout and simple English copy', async()=>{
  const [app,css]=await Promise.all([read('app.js'),read('styles/dialogs.css')]);
  assert.match(app,/Intl\.DateTimeFormat\('en-GB'/);
  assert.match(app,/formatPaydayDate/); assert.match(app,/Who can join\?/); assert.match(app,/Confirmed · 17:00/); assert.match(app,/✓ In/); assert.doesNotMatch(app,/Trykk på navnet|Hvem kan denne dagen|bekreftet kl\./);
  assert.match(css,/\.payday-dialog\{width:min\(620px/);
  assert.match(css,/\.payday-dialog-inner\{padding:24px/);
  assert.match(css,/\.payday-voter-list\{grid-template-columns:repeat\(2/);
  assert.match(css,/@media\(max-width:620px\)[\s\S]*?\.payday-voter-list\{grid-template-columns:1fr/);
});


test('hero dashboard counts down to confirmed lønningspils before seasonal events', async()=>{
  const [html,app,backend,css]=await Promise.all([read('index.html'),read('app.js'),read('backend-adapter.js'),readCss()]);
  assert.match(html,/class="hero-status"/); assert.match(html,/id="event-countdown"/); assert.doesNotMatch(html,/Loading event/);
  assert.match(app,/confirmedPaydayDates/);
  assert.match(app,/name:'Lønningspils'/);
  assert.match(app,/name:'Halloween'/);
  assert.match(app,/name:'Christmas'/);
  assert.match(app,/name:'Easter'/);
  assert.match(app,/name:'17 May'/);
  assert.match(app,/name:'Summer break'/);
  assert.match(app,/isoWeekFriday\(y, 27\)/);
  assert.match(app,/easterDate\(y\)/);
  assert.match(backend,/getPaydayEvents/);
  assert.match(backend,/setPaydayEvent/);
  assert.match(css,/\.hero-event-card/);
});


test('green deeds are anonymous shared counters with bike, walk and carpool choices', async()=>{
  const [html,app,backend,css]=await Promise.all([read('index.html'),read('app.js'),read('backend-adapter.js'),readCss()]);
  assert.match(html,/id="green-deeds"/);
  assert.match(html,/data-green-deed="bike"/);
  assert.match(html,/data-green-deed="walk"/);
  assert.match(html,/data-green-deed="carpool"/);
  assert.match(app,/function addGreenDeed/);
  assert.match(app,/greenDeedCount/);
  assert.match(backend,/getGreenDeeds/);
  assert.match(backend,/addGreenDeed/);
  assert.doesNotMatch(app,/greenDeed.*driverId|driverId.*greenDeed/i);
  assert.match(css,/\.green-deeds-card/);
  assert.match(css,/\.green-deed-options/);
});


test('green deeds dialog uses robust delegated click handling and matching dashboard card layout', async()=>{
  const [html,app,css]=await Promise.all([read('index.html'),read('app.js'),readCss()]);
  assert.match(html,/GREEN DEEDS/);
  assert.match(html,/Bike · Walk · Carpool/);
  assert.match(app,/function openDialogSafe/);
  assert.match(app,/event\.target\.closest\?\.\('#green-deeds'\)/);
  assert.match(app,/event\.target\.closest\?\.\('\[data-green-deed\]'\)/);
  assert.match(css,/\.hero-event-card,\.green-deeds-card\{display:grid/);
  assert.match(css,/\.hero-event-card\{flex:2\.6 1 520px;min-width:420px\}/);
});


test('desktop hero cards share one aligned height and balanced grid', async()=>{
  const css=await read('styles/responsive.css');
  assert.match(css,/@media\(min-width:1121px\)/);
  assert.match(css,/grid-template-columns:270px minmax\(0,1fr\) 430px/);
  assert.match(css,/grid-template-columns:minmax\(0,1fr\) 260px/);
  assert.match(css,/grid-template-columns:126px 126px 162px/); assert.match(css,/\.hero-date h2\{white-space:nowrap\}/);
  assert.match(css,/\.hero-event-card,\.green-deeds-card\{width:100%;min-width:0;min-height:62px;height:62px\}/);
  assert.match(css,/\.summary-item\{width:100%;min-width:0;min-height:62px;align-content:center\}/);
});


test('mobile social section is placed after the main parking content', async()=>{
  const html=await read('index.html');
  const overview=html.indexOf('class="overview-grid"');
  const schedule=html.indexOf('class="schedule-panel"');
  const social=html.indexOf('id="payday-mobile"');
  assert.ok(overview >= 0 && schedule >= 0 && social >= 0);
  assert.ok(social > overview);
  assert.ok(social > schedule);
});
