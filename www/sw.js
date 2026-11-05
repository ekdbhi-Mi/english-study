/* 서비스 워커: 오프라인 사용 + 알림 */
const CACHE = 'estudy-v1';
const FILES = ['./', 'index.html', 'style.css', 'core.js', 'app.js', 'data/books.js', 'data/packs.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(cs => cs.length ? cs[0].focus() : self.clients.openWindow('./index.html')));
});
// 가끔 깨어나서 "아직 공부 안 했으면" 알림 (정확한 시간 보장은 안 돼요)
function readMeta() {
  return new Promise(res => {
    const r = indexedDB.open('estudy', 1);
    r.onsuccess = () => { try { const q = r.result.transaction('kv').objectStore('kv').get('meta'); q.onsuccess = () => res(q.result); q.onerror = () => res(null); } catch (e) { res(null); } };
    r.onerror = () => res(null);
  });
}
self.addEventListener('periodicsync', e => {
  if (e.tag !== 'daily-check') return;
  e.waitUntil((async () => {
    const m = await readMeta(); if (!m || !m.on) return;
    const n = new Date(), p = x => String(x).padStart(2, '0');
    const today = n.getFullYear() + '-' + p(n.getMonth() + 1) + '-' + p(n.getDate());
    const [hh, mm] = (m.time || '21:00').split(':').map(Number);
    const due = n.getHours() > hh || (n.getHours() === hh && n.getMinutes() >= mm);
    if (due && m.doneDate !== today && m.last !== today)
      await self.registration.showNotification('오늘의 5문장 📖', { body: '영어 원서 공부할 시간이에요!', icon: 'icon-192.png', tag: 'daily' });
  })());
});
