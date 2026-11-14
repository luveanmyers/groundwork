/*
  firebase-config.js - which Firebase project this copy of SetOut talks to
  -------------------------------------------------------------------------
  SetOut uses two Firebase projects (see the Linear doc "SetOut - Sync
  Design"):

    setout-dev  for local testing and branch previews
    setout      for the real app on GitHub Pages, holding real trips
                (project ID setout-95ed9)

  Keeping them apart means a half-finished branch can never read, change
  or delete real trip data. The real site's address is the only thing
  that selects the real project; every other address (localhost, preview
  URLs) gets dev.

  Is it safe that these values are in a public repo? Yes. A Firebase web
  config isn't a password: it only tells the browser which project to
  talk to. What protects the data is firestore.rules (signed in, verified
  email, on the trip's member list). That's also why the "apiKey" below
  can't be used to read anything on its own.
*/

const FIREBASE_CONFIGS = {
  dev: {
    apiKey: "AIzaSyDhqtf3BZUhdZLoUKY_1jM7T_cdi0JwdUk",
    authDomain: "setout-dev.firebaseapp.com",
    projectId: "setout-dev",
    storageBucket: "setout-dev.firebasestorage.app",
    messagingSenderId: "477440016099",
    appId: "1:477440016099:web:9fc45fe7f56fcab7d6cfd6"
  },
  // The real project. Its display name is "SetOut", but Firebase
  // project IDs are global and "setout" was taken, so Firebase added a
  // suffix: the ID is setout-95ed9.
  prod: {
    apiKey: "AIzaSyAr9aZ5EbQW8u6xEfQizOBX_k0vQschgsk",
    authDomain: "setout-95ed9.firebaseapp.com",
    projectId: "setout-95ed9",
    storageBucket: "setout-95ed9.firebasestorage.app",
    messagingSenderId: "505857475675",
    appId: "1:505857475675:web:eb517fb03a54e9e5f8ab7e"
  }
};

// The real site is the only place real data is allowed.
const PROD_HOSTNAME = "luveanmyers.github.io";

const FIREBASE_ENV = location.hostname === PROD_HOSTNAME ? "prod" : "dev";
const FIREBASE_CONFIG = FIREBASE_CONFIGS[FIREBASE_ENV];
