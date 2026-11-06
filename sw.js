// 서비스 워커: 오프라인에서도 열리게 캐시. 앱을 고쳐 배포할 때마다 숫자를 올린다.
const CACHE = 'part-spec-v1';
const FILES = ['./', 'index.html', 'calc.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // AI 서버 요청은 건드리지 않음
  const fresh = u.pathname.endsWith('/') || /\.(html|js)$/.test(u.pathname);
  if (fresh) {   // 화면·계산 코드는 네트워크 먼저 (새 버전), 실패하면 캐시
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
  } else {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  }
});
