const CACHE = 'gt-parking-shell-v6-force-fresh';
const SHELL = [
  './','./index.html','./styles.css','./styles/base.css','./styles/overview.css','./styles/schedule.css','./styles/dialogs.css','./styles/responsive.css','./app.js','./schedule-view.js','./room-dialog-controller.js','./config.js','./backend-adapter.js','./booking-utils.js','./parking-map.js','./meeting-room.js',
  './parking-config.json','./drivers.txt','./manifest.webmanifest','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png','./assets/goodtech-logo.webp','./robots.txt'
];

self.addEventListener('install', event => event.waitUntil(
  caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())
));

self.addEventListener('activate', event => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
  await self.clients.claim();
  // A newly activated worker means a deployment happened. Reload open app windows once
  // so they cannot continue running an older cached app.js/backend-adapter.js.
  const clients = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
  await Promise.all(clients.map(client => client.navigate(client.url).catch(() => null)));
})()));

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Network first for the complete same-origin app shell. GitHub Pages is the source of
  // truth; cache is only an offline fallback. This prevents old JS/CSS from surviving updates.
  event.respondWith(
    fetch(event.request, { cache:'no-store' })
      .then(response => {
        if (response.ok) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html')))
  );
});
