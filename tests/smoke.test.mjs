import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const read=path=>fs.readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('PWA files and install metadata are present', async()=>{
  const [html,manifest,sw]=await Promise.all([read('index.html'),read('manifest.webmanifest'),read('sw.js')]);
  assert.match(html,/manifest\.webmanifest/); assert.match(html,/install-app/);
  const parsed=JSON.parse(manifest); assert.equal(parsed.short_name,'GT Parking'); assert.equal(parsed.display,'standalone'); assert.equal(parsed.scope,'./');
  assert.match(sw,/gt-parking-shell-v2-/);
});

test('mobile safe gutters, sticky column and no page overflow rules exist', async()=>{
  const css=await read('styles.css');
  assert.match(css,/@media\(max-width:390px\)/); assert.match(css,/calc\(100% - 30px\)/); assert.match(css,/position:sticky;left:0/); assert.match(css,/html\{overflow-x:hidden/);
});

test('map matches requested physical grouping', async()=>{
  const map=await read('parking-map.js');
  assert.match(map,/mg-50','mg-51','mg-52','mg-53','mg-54'/); assert.match(map,/mg-69/); assert.match(map,/f18-nedreplan/); assert.match(map,/f18-ovreplan/);
});

test('app includes live polling, weekend focus, duplicate text and no login', async()=>{
  const [app,html]=await Promise.all([read('app.js'),read('index.html')]);
  assert.match(app,/APP_CONFIG\.pollMs/); assert.match(app,/initialWeekDate/); assert.match(app,/Already has/); assert.doesNotMatch(html,/password/i); assert.doesNotMatch(html,/login/i);
});

test('robots discourages indexing', async()=>{ assert.match(await read('robots.txt'),/Disallow: \//); });
