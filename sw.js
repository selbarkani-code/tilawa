// Service worker : garde l'app, ses bibliothèques et la police en cache pour l'usage hors ligne.
// (Les fichiers du modèle vocal sont mis en cache directement par la bibliothèque, dans le worker.)
const VERSION = 'tilawa-v1';
const EXT = 'tilawa-ext'; // bibliothèques externes, conservées entre les versions
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'align.js', 'asr-worker.js',
  'recorder-worklet.js', 'quran.json', 'manifest.json', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k.startsWith('tilawa-') && k !== VERSION && k !== EXT).map((k) => caches.delete(k))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (/huggingface\.co|hf\.co|xethub/.test(url.hostname)) return; // géré par la bibliothèque

  if (url.origin === self.location.origin) {
    // L'app : cache d'abord, mise à jour en arrière-plan
    e.respondWith(caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  if (/cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url.hostname)) {
    // Bibliothèques et police : cache d'abord (fichiers versionnés)
    e.respondWith(caches.open(EXT).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    }));
  }
});
