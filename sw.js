/* 간단한 오프라인 캐시 서비스 워커 (앱 설치용) */
const CACHE = "jeti-v1";
const ASSETS = [
  "./",
  "./index.html", "./home.css",
  "./boyle.html", "./style.css", "./script.js",
  "./charles.html", "./charles.css", "./charles.js",
  "./avogadro.html", "./avogadro.css", "./avogadro.js",
  "./ion.html", "./ion.css", "./ion.js",
  "./wave.html", "./wave.css", "./wave.js",
  "./ohm.html", "./ohm.css", "./ohm.js",
  "./resistance.html", "./resistance.css", "./resistance.js",
  "./accel.html", "./accel.css", "./accel.js",
  "./weather.html", "./weather.css", "./weather.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 페이지/정적 파일: 네트워크 우선, 실패 시 캐시 (항상 최신 유지, 오프라인 대비)
// 외부 API(관측값 등)는 캐시하지 않음
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
