/*
  auth.js - signing in with Google (LUV-40)
  ------------------------------------------
  This is the only file that talks to Firebase Authentication. It's a
  JavaScript *module* (loaded with type="module" in index.html) because
  Firebase ships its browser SDK as modules. The rest of the app is
  plain scripts, so this file hands app.js a tiny interface on `window`
  instead of the other way round:

    window.setoutAuth.signIn()   opens Google's sign-in window
    window.setoutAuth.signOut()  signs out on this device only

  and calls app.js's handleAuthChange(user) whenever the signed-in
  person changes, including once at start-up with whoever is already
  signed in on this device.

  Firebase remembers the sign-in on the device (in IndexedDB), and it
  reports it even with no signal. That's what lets the app open straight
  to Home offline after the first sign-in.

  The SDK comes from Google's CDN at a pinned version, because there's
  no build step. The service worker caches these files like the rest of
  the app, so they load offline after the first visit.
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

// FIREBASE_CONFIG comes from firebase-config.js: the dev project
// everywhere except the real site.
const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
// Always show Google's account chooser. Without this, a device with only
// one Google account signs in with it silently - which is how the test
// page ended up on a work account with no way to pick another.
provider.setCustomParameters({ prompt: "select_account" });

window.setoutAuth = {
  // A pop-up rather than a full-page redirect: the pop-up is what was
  // tested and worked from the iPhone Home Screen app (LUV-40). Resolves
  // when sign-in completes; rejects if the window is closed or fails.
  signIn: () => signInWithPopup(auth, provider),
  signOut: () => signOut(auth)
};

onAuthStateChanged(auth, (user) => {
  // Hand app.js only what it needs, not Firebase's whole user object.
  handleAuthChange(user ? { uid: user.uid, email: user.email } : null);
});
