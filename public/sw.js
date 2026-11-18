// Service worker: app abre offline; dados = rede primeiro, cache como reserva; escudos em cache.
const VERSION = 'meuplacar-v3';
const BASE = new URL('./', self.location).pathname; // ex.: /meuplacar/
const SHELL = ['', 'index.html', 'styles.css', 'app.js', 'api.js', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'].map((p) => BASE + p);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('meuplacar-v') && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // dados (./data/*.json e ESPN direto): rede primeiro, cache se offline
  if ((url.origin === location.origin && url.pathname.startsWith(BASE + 'data/')) || url.hostname === 'site.api.espn.com') {
    e.respondWith((async () => {
      const cache = await caches.open('meuplacar-data');
      const key = url.origin + url.pathname + (url.hostname === 'site.api.espn.com' ? url.search : '');
      try {
        const res = await fetch(e.request);
        if (res.ok) cache.put(key, res.clone());
        return res;
      } catch (err) {
        const hit = await cache.match(key);
        if (hit) return hit;
        throw err;
      }
    })());
    return;
  }

  // arquivos do app: cache + atualiza em segundo plano
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const hit = await cache.match(e.request, { ignoreSearch: true });
      const net = fetch(e.request).then((r) => { if (r.ok) cache.put(e.request, r.clone()); return r; }).catch(() => null);
      return hit || (await net) || cache.match(BASE + 'index.html');
    })());
    return;
  }

  // escudos e logos: cache primeiro (ficam salvos no celular)
  if (e.request.destination === 'image') {
    e.respondWith((async () => {
      const cache = await caches.open('meuplacar-img');
      const hit = await cache.match(e.request);
      if (hit) return hit;
      try { const r = await fetch(e.request); if (r.ok || r.type === 'opaque') cache.put(e.request, r.clone()); return r; } catch { return Response.error(); }
    })());
  }
});
