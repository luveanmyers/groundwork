/*
  firebase-init.js - starts Firebase once, for everything that needs it
  ----------------------------------------------------------------------
  Both auth.js (signing in) and sync.js (reading and writing trips) need
  the same Firebase "app". Firebase refuses to start the same app twice,
  so it's started here, once, and the other two modules import it.

  FIREBASE_CONFIG comes from firebase-config.js: the dev project
  everywhere except the real site.
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

export const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);

// The offline copy. persistentLocalCache keeps every trip this device
// has seen in the browser's IndexedDB, so the app opens and works with
// no signal, and queues edits made offline until it can send them.
// The multiple-tab manager lets two open tabs share one copy instead of
// one of them silently losing offline support.
//
// ignoreUndefinedProperties: a field that's `undefined` in JavaScript is
// simply left out instead of making Firestore reject the whole write.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  ignoreUndefinedProperties: true
});
