/* 만천초 여비 정산 신청서 — 서비스 워커
   - 핵심 파일은 stale-while-revalidate: 캐시로 즉시 열고, 뒤에서 새 버전을 받아 다음 실행에 반영
   - 한 번 열어 둔 양식은 오프라인에서도 그대로 열림(입력 내용은 기기에 저장)
*/
var CACHE = 'travel-settlement-v4';
var CORE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './favicon.ico'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(CORE).catch(function () {
        return Promise.all(CORE.map(function (url) {
          return cache.add(url).catch(function () { });
        }));
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function update(req) {
  return fetch(req).then(function (res) {
    if (res && res.ok && res.type === 'basic') {
      var copy = res.clone();
      caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
    }
    return res;
  }).catch(function () { return null; });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  var bg = update(req);
  event.waitUntil(bg);

  event.respondWith((async function () {
    var cache = await caches.open(CACHE);
    var cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;

    var fresh = await bg;
    if (fresh) return fresh;

    if (req.mode === 'navigate') {
      var fallback = (await cache.match('./index.html')) || (await cache.match('./'));
      if (fallback) return fallback;
    }

    return new Response(
      '<!doctype html><meta charset="utf-8"><title>오프라인</title>' +
      '<div style="font:16px/1.7 -apple-system,BlinkMacSystemFont,\'Malgun Gothic\',sans-serif;padding:32px">' +
      '<h1 style="font-size:19px">오프라인 상태입니다</h1>' +
      '<p>인터넷에 연결되면 다시 열어 주세요. 한 번 열어 둔 양식은 오프라인에서도 그대로 열립니다.</p></div>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  })());
});
