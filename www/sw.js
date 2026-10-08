// Gameboy Zone service worker.
// Bump APP_VERSION whenever you change any app file, so phones pick up the update.
const APP_VERSION = "gbz-v8";
const SHELL_CACHE = `${APP_VERSION}-shell`;
const ENGINE_CACHE = "gbz-engine-4.2.3"; // matches EJS_VERSION in app.js
const FONT_CACHE = "gbz-fonts";

const SHELL_FILES = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/home.js",
  "/home.css",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-64.png",
  "/icons/logo.webp",
];

const KEEP = new Set([SHELL_CACHE, ENGINE_CACHE, FONT_CACHE]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache-first: for versioned files that never change at the same URL.
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // <script> and <link> tags fetch cross-origin files without CORS, which
  // returns "opaque" responses (status 0). Those are still safe to cache here.
  if (response.ok || response.type === "opaque") cache.put(request, response.clone());
  return response;
}

// Network-first: for the app's own files, so updates show up when online.
async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === "navigate") {
      const shell = await cache.match("/index.html");
      if (shell) return shell;
    }
    throw new Error("Offline and not cached");
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Pinned emulator engine and cores
  if (url.origin === "https://cdn.emulatorjs.org" && url.pathname.startsWith("/4.2.3/")) {
    event.respondWith(cacheFirst(request, ENGINE_CACHE));
    return;
  }

  // Web fonts
  if (url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com") {
    event.respondWith(cacheFirst(request, FONT_CACHE));
    return;
  }

  // The app itself
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  }
});
