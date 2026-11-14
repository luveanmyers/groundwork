/*
  sw.js - the service worker
  ---------------------------
  A service worker is a script the browser runs in the background,
  separately from your page, that can intercept network requests. That's
  what lets a web app keep working with zero signal: we save copies of
  the app's files and can serve those saved copies when there's no
  network at all.

  Strategy: "stale-while-revalidate" (switched from cache-first, LUV-27).
  Every request is answered from the cache immediately when possible, so
  the app opens instantly and works offline. At the same time, the
  worker quietly fetches a fresh copy from the network and saves it for
  next time. The cost is a one-launch lag: the launch right after a
  deploy still shows the previous version, and the one after that is
  current. The upside is that a forgotten CACHE_NAME bump can no longer
  leave installs stuck on old code forever, which is exactly what
  happened between 2026-09-06 and 2026-11-14.

  CACHE_NAME is still worth bumping when APP_SHELL itself changes (a file
  added, removed or renamed), so the old cache gets cleaned up on
  activate.
*/

const CACHE_NAME = "setout-v2";

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
  "./icons/icon-512.png",
  "./icons/favicon-32.png"
];

// On install: download and cache every file in APP_SHELL. `cache: "reload"`
// skips the browser's ordinary HTTP cache, which GitHub Pages lets hold
// files for up to 10 minutes, so a fresh install gets the real latest files.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: "reload" })))
    )
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

// Fetch a fresh copy of a request and save it in the cache for next time.
// Our own files are revalidated with the server (`cache: "no-cache"`) so
// the 10-minute HTTP cache can't hand us a stale copy. Other sites' files
// (Google Fonts) are fetched normally - their URLs change when their
// content does, so their normal caching is safe.
function fetchAndCache(request) {
  const isOwnFile = new URL(request.url).origin === self.location.origin;
  const networkRequest = isOwnFile
    ? new Request(request.url, { cache: "no-cache", credentials: "same-origin" })
    : request;

  return fetch(networkRequest).then((response) => {
    // Only save real successes. "opaque" is how the browser reports a
    // successful response from another site that it won't let us read.
    if (response.ok || response.type === "opaque") {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    }
    return response;
  });
}

// On every fetch: answer from the cache right away if we have a copy, and
// refresh that copy in the background. If nothing is cached yet, wait for
// the network instead. A page navigation with no network and no exact
// cached match falls back to the cached index.html, so the app still opens.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const refresh = fetchAndCache(event.request);

  // Keep the worker alive until the background refresh finishes, and
  // swallow its error when offline - the cached copy already answered.
  event.waitUntil(refresh.then(() => {}, () => {}));

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return refresh.catch(() => {
        if (event.request.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      });
    })
  );
});
