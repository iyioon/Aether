const CACHE_PREFIX = "aether-shell-";
const CACHE_NAME = CACHE_PREFIX + "__BUILD_ID__";
const PRECACHE = __PRECACHE_URLS__;
const STATIC_PATHS = new Set(PRECACHE);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Private API responses and media always go directly to the authenticated server.
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  )
    return;
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const shell = await cache.match("/index.html");
        if (shell) return shell;
        return fetch(request).catch(
          async () => (await cache.match("/offline.html")) || Response.error()
        );
      })()
    );
    return;
  }
  if (STATIC_PATHS.has(url.pathname)) {
    event.respondWith(
      caches
        .open(CACHE_NAME)
        .then(
          async (cache) => (await cache.match(url.pathname)) || fetch(request)
        )
    );
  }
});
