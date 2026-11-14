/*
  firebase-config.js - which Firebase project this copy of SetOut talks to
  -------------------------------------------------------------------------
  SetOut uses two Firebase projects (see the Linear doc "SetOut - Sync
  Design"):

    setout-dev  for local testing and branch previews
    setout      for the real app on GitHub Pages, holding real trips

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
  // Filled in once the real "setout" project exists (LUV-39). Until then
  // the real site has no project, so sync stays off there rather than
  // quietly falling back to the dev project.
  prod: null
};

// The real site is the only place real data is allowed.
const PROD_HOSTNAME = "luveanmyers.github.io";

const FIREBASE_ENV = location.hostname === PROD_HOSTNAME ? "prod" : "dev";
const FIREBASE_CONFIG = FIREBASE_CONFIGS[FIREBASE_ENV];
