/* 만천초 국내여비 정산 신청서 — 서비스 워커
   - 화면(index.html)은 network-first: 열 때마다 서버에서 새 판을 먼저 받아 바로 반영하고,
     인터넷이 없을 때만 캐시로 연다. (예전 cache-first 방식은 새 양식이 늦게 반영됐다)
   - 아이콘·매니페스트 같은 고정 파일은 stale-while-revalidate: 캐시로 즉시 열고 뒤에서 갱신
   - 한 번 열어 둔 양식은 오프라인에서도 그대로 열림(입력 내용은 기기에 저장)
*/
var CACHE = 'travel-settlement-v14';
var SHELL = new URL('./index.html', self.location.href).href;
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

function offlinePage() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><title>오프라인</title>' +
    '<div style="font:16px/1.7 -apple-system,BlinkMacSystemFont,\'Malgun Gothic\',sans-serif;padding:32px">' +
    '<h1 style="font-size:19px">오프라인 상태입니다</h1>' +
    '<p>인터넷에 연결되면 다시 열어 주세요. 한 번 열어 둔 양식은 오프라인에서도 그대로 열립니다.</p></div>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

function update(req) {
  /* cache:'reload' — 브라우저 HTTP 캐시(max-age=600)에 남은 예전 파일을 쓰지 않고
     서버에서 새 파일을 받아 캐시에 넣는다. */
  return fetch(req, { cache: 'reload' }).then(function (res) {
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

  /* 화면 이동: 서버 → 없으면 캐시 */
  if (req.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/travel-settlement/')) {
    event.respondWith((async function () {
      try {
        var fresh = await fetch(req, { cache: 'reload' });
        if (fresh && fresh.ok) {
          var copy = fresh.clone();
          caches.open(CACHE).then(function (cache) { cache.put(SHELL, copy); });
          return fresh;
        }
      } catch (e) { }
      var cache = await caches.open(CACHE);
      var cached = (await cache.match(SHELL, { ignoreSearch: true })) || (await cache.match(new URL('./', self.location.href).href));
      return cached || offlinePage();
    })());
    return;
  }

  /* 그 밖의 파일: 캐시 먼저, 뒤에서 갱신 */
  var bg = update(req);
  event.waitUntil(bg);
  event.respondWith((async function () {
    var cache = await caches.open(CACHE);
    var cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    var fresh = await bg;
    if (fresh) return fresh;
    return offlinePage();
  })());
});
