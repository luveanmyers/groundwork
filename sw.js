/*
  sw.js - the service worker
  ---------------------------
  A service worker is a script the browser runs in the background,
  separately from your page, that can intercept network requests. That's
  what lets a web app keep working with zero signal: instead of always
  going to the network, we save copies of the app's files the first time
  they load, and serve those saved copies from then on.

  Bump CACHE_NAME (e.g. to "trip-planner-v2") whenever you change any of
  the files listed in APP_SHELL below, so returning users get the update
  instead of a stale cached copy.
*/

const CACHE_NAME = "groundwork-v1";

// The "app shell" - everything needed to run the app with no network at all.
// Your actual trip DATA lives in localStorage (see storage.js), not here;
// this cache only holds the code/HTML/CSS/icons.
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/storage.js",
  "./js/app.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

// On install: download and cache every file in APP_SHELL.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// On activate: delete caches from older versions of the app.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// On every fetch: try the cache first (instant + works offline). If it's
// not in the cache, fall back to the network and cache what comes back so
// it's available offline next time too.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => cached);
    })
  );
});
